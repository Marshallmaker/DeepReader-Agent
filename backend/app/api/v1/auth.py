"""
认证 API 接口。
包含用户注册、登录、Token刷新、忘记密码、个人信息管理等功能。
"""
import re
import hashlib
import logging
import random
import string
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, Response, Cookie, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.password_reset_code import PasswordResetCode
from app.schemas.user import UserCreate, UserLogin, Token, TokenRefresh, UserResponse, UserUpdate, ChangeEmailSendCodeRequest, ChangeEmailVerifyRequest, ForgotPasswordApply, ForgotPasswordReset, ForgotPasswordResponse, RegisterSendCodeRequest, CheckEmailRequest
from app.utils.auth import (
    get_password_hash, verify_password,
    create_access_token, create_refresh_token, verify_token
)
from app.config import settings
from app.utils.email import send_verification_email
from app.utils.email_validation import validate_email_domain
from app.api.dependencies import get_current_user

router = APIRouter()

# 密码复杂度正则表达式（8-20位，包含大写、小写、数字、特殊符号中的至少三种）
PASSWORD_COMPLEXITY_REGEX = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,20}$'
)

# 安全相关日志记录器
logger = logging.getLogger(__name__)


@router.post("/check-email")
async def check_email(data: CheckEmailRequest, db: Session = Depends(get_db)):
    """
    检查邮箱是否已被注册，同时校验邮箱域名合法性。

    功能说明：
    - 公开接口，无需登录
    - 先校验邮箱域名 TLD 是否合法（拦截 .comm 等拼写错误）
    - 再查询邮箱是否已被注册

    Args:
        data: 待检查的邮箱地址
        db: 数据库会话

    Returns:
        { exists: bool, domain_valid: bool, error_message: str|null }
    """
    # 1. 域名严格校验
    is_valid, error_message = validate_email_domain(data.email)
    if not is_valid:
        return {"exists": False, "domain_valid": False, "error_message": error_message}

    # 2. 查询邮箱是否已注册
    user = db.query(User).filter(User.email == data.email).first()
    return {"exists": user is not None, "domain_valid": True, "error_message": None}


@router.post("/register/send-code", response_model=ForgotPasswordResponse)
async def register_send_code(data: RegisterSendCodeRequest, db: Session = Depends(get_db)):
    """
    注册第一步：向注册邮箱发送验证码。

    功能说明：
    - 验证邮箱格式
    - 检查邮箱是否已被注册（已注册则拒绝）
    - 生成 6 位数字验证码，发送到注册邮箱
    - 验证码有效期 10 分钟
    - 新码熔断旧码

    Args:
        data: 注册邮箱
        db: 数据库会话

    Returns:
        统一消息
    """
    # 验证邮箱格式和域名合法性
    is_valid, error_message = validate_email_domain(data.email)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )

    # 检查邮箱是否已被注册
    existing_user = db.query(User).filter(User.email == data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被注册"
        )

    # 新码熔断旧码
    db.query(PasswordResetCode).filter(
        PasswordResetCode.email == data.email,
        PasswordResetCode.is_used == False,
        PasswordResetCode.expired_at > datetime.now()
    ).update({"is_used": True})

    # 生成 6 位数字验证码
    verification_code = ''.join(random.choices(string.digits, k=6))

    # 计算 SHA-256 哈希值
    code_hash = hashlib.sha256(verification_code.encode()).hexdigest()

    # 计算过期时间
    expired_at = datetime.now() + timedelta(minutes=10)

    # 创建验证码记录
    reset_code = PasswordResetCode(
        email=data.email,
        code_hash=code_hash,
        retry_count=0,
        is_used=False,
        expired_at=expired_at
    )
    db.add(reset_code)
    db.commit()

    # 发送验证码邮件
    email_sent = send_verification_email(data.email, verification_code)

    if not email_sent:
        logger.error(f"Failed to send verification email to {data.email}")

    return ForgotPasswordResponse(
        status="success",
        message="验证码已发送至您的注册邮箱，请在 10 分钟内完成验证。"
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    用户注册接口（第二步：验证验证码 + 创建账号）。

    功能说明：
    - 验证邮箱格式和唯一性
    - 验证邮箱验证码（6位数字）
    - 使用 bcrypt 对密码进行哈希加密
    - 创建新用户，默认 is_active=True

    Args:
        user_data: 用户注册数据（email, password, nickname, verification_code）
        db: 数据库会话

    Returns:
        新创建的用户信息
    """
    # 验证邮箱格式和域名合法性
    is_valid, error_message = validate_email_domain(user_data.email)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )

    # 检查邮箱是否已存在
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被注册"
        )

    # ── 验证邮箱验证码 ──
    code_hash = hashlib.sha256(user_data.verification_code.encode()).hexdigest()

    reset_record = db.query(PasswordResetCode).filter(
        PasswordResetCode.email == user_data.email,
        PasswordResetCode.code_hash == code_hash,
        PasswordResetCode.is_used == False
    ).first()

    if not reset_record:
        # 增加输错计数
        existing_record = db.query(PasswordResetCode).filter(
            PasswordResetCode.email == user_data.email,
            PasswordResetCode.is_used == False,
            PasswordResetCode.expired_at > datetime.now()
        ).first()
        if existing_record:
            existing_record.retry_count += 1
            db.commit()
            if existing_record.retry_count >= 5:
                existing_record.is_used = True
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="验证码输错次数已达上限，该验证码已报废，请重新获取。"
                )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效、已过期或已被重复使用，请重新获取。"
        )

    if datetime.now() > reset_record.expired_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码已过期，请重新获取。"
        )

    if reset_record.retry_count >= 5:
        reset_record.is_used = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码输错次数已达上限，该验证码已报废，请重新获取。"
        )

    # 标记验证码已使用
    reset_record.is_used = True

    # 创建新用户
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        password_hash=hashed_password,
        nickname=user_data.nickname,
        is_admin=False,
        is_active=True
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@router.post("/login", response_model=Token)
async def login(user_data: UserLogin, remember_me: bool = False, response: Response = Response(), db: Session = Depends(get_db)):
    """
    用户登录接口
    
    功能说明：
    - 验证用户凭证
    - 返回 access_token 在响应体中
    - 设置 refresh_token 为 httpOnly cookie
    - 支持 remember_me 功能：
      - 若勾选：refresh_token cookie 持久化 7 天
      - 若未勾选：refresh_token 为会话级 Cookie，关闭浏览器即失效
    
    Args:
        user_data: 用户登录数据（email, password）
        remember_me: 是否记住密码
        response: FastAPI Response 对象
        db: 数据库会话
        
    Returns:
        Token 对象（access_token, refresh_token, is_admin）
    """
    # 查找用户
    user = db.query(User).filter(User.email == user_data.email).first()
    
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 检查用户是否被禁用
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="用户账号已被禁用"
        )
    
    # 创建 Token
    token_data = {"sub": str(user.id), "email": user.email, "is_admin": user.is_admin}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token({"sub": str(user.id)})
    
    # 设置 refresh token 为 httpOnly cookie
    cookie_kwargs = {
        "key": "refresh_token",
        "value": refresh_token,
        "httponly": True,
        "secure": not settings.DEBUG,  # 开发环境 False，生产环境 True（HTTPS）
        "samesite": "lax"
    }
    
    # 根据 remember_me 设置 cookie 有效期
    # 若勾选记住密码，设置 Max-Age 为 7 天（持久化 Cookie）
    # 若未勾选，不设置 Max-Age（会话级 Cookie，关闭浏览器即失效）
    if remember_me:
        cookie_kwargs["max_age"] = 7 * 24 * 60 * 60  # 7 天
    
    response.set_cookie(**cookie_kwargs)
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        is_admin=user.is_admin
    )


@router.post("/refresh", response_model=TokenRefresh)
async def refresh_token(refresh_token: str = Cookie(None), db: Session = Depends(get_db)):
    """
    Token 刷新接口
    
    功能说明：
    - 从 cookie 中获取 refresh_token
    - 验证 refresh_token 并生成新的 access_token
    
    Args:
        refresh_token: 从 cookie 中获取的 refresh_token
        db: 数据库会话
        
    Returns:
        新的 access_token
    """
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供 refresh_token"
        )
    
    # 验证 refresh token
    try:
        payload = verify_token(refresh_token, token_type="refresh")
        user_id = payload.get("sub")
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="无效的 refresh_token"
            )
        
        # 获取用户
        user = db.query(User).filter(User.id == int(user_id)).first()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户不存在或已被禁用"
            )
        
        # 创建新的 access token
        token_data = {"sub": str(user.id), "email": user.email, "is_admin": user.is_admin}
        access_token = create_access_token(token_data)
        
        return TokenRefresh(access_token=access_token)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效或已过期的 refresh_token"
        )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    获取当前用户信息接口
    
    功能说明：
    - 需要有效的 access_token
    - 返回当前登录用户的详细信息
    
    Args:
        current_user: 当前登录用户（通过依赖注入获取）
        
    Returns:
        用户信息
    """
    return current_user


@router.put("/me", response_model=UserResponse)
async def update_current_user_info(
    update_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    更新当前用户个人信息接口（仅限昵称）。

    功能说明：
    - 可直接更新昵称，无需密码验证
    - 邮箱修改请使用 /auth/me/change-email 验证码流程
    - 头像修改请使用 /auth/me/avatar 上传接口

    Args:
        update_data: 要更新的字段（仅 nickname）
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        更新后的用户信息
    """
    # 更新昵称
    if update_data.nickname is not None:
        if not update_data.nickname.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="昵称不能为空"
            )
        current_user.nickname = update_data.nickname.strip()
        db.commit()
        db.refresh(current_user)

    return current_user


@router.post("/me/change-email/send-code", response_model=ForgotPasswordResponse)
async def change_email_send_code(
    data: ChangeEmailSendCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    修改邮箱第一步：向新邮箱发送验证码。

    功能说明：
    - 验证新邮箱是否已被其他用户使用
    - 生成 6 位数字验证码，发送到新邮箱
    - 验证码有效期 10 分钟
    - 新码熔断旧码（同一用户 + 同一新邮箱的旧验证码自动作废）

    Args:
        data: 新邮箱地址
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        统一模糊提示消息
    """
    # 域名严格校验（拦截 .comm 等明显拼写错误）
    is_valid, error_message = validate_email_domain(data.new_email)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )

    # 检查新邮箱是否已被其他用户使用
    existing = db.query(User).filter(
        User.email == data.new_email,
        User.id != current_user.id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被其他账号使用"
        )

    # 新码熔断旧码：将同一邮箱所有未使用的旧验证码标记为已使用
    db.query(PasswordResetCode).filter(
        PasswordResetCode.email == data.new_email,
        PasswordResetCode.is_used == False,
        PasswordResetCode.expired_at > datetime.now()
    ).update({"is_used": True})

    # 生成 6 位数字验证码
    verification_code = ''.join(random.choices(string.digits, k=6))

    # 计算 SHA-256 哈希值
    code_hash = hashlib.sha256(verification_code.encode()).hexdigest()

    # 计算过期时间（当前时间 + 10分钟）
    expired_at = datetime.now() + timedelta(minutes=10)

    # 创建验证码记录
    reset_code = PasswordResetCode(
        email=data.new_email,
        code_hash=code_hash,
        retry_count=0,
        is_used=False,
        expired_at=expired_at
    )
    db.add(reset_code)
    db.commit()

    # 发送验证码邮件
    email_sent = send_verification_email(data.new_email, verification_code)

    if not email_sent:
        logger.error(f"Failed to send verification email to {data.new_email}")

    return ForgotPasswordResponse(
        status="success",
        message="验证码已发送至新邮箱，请在 10 分钟内完成验证。"
    )


@router.post("/me/change-email/verify", response_model=UserResponse)
async def change_email_verify(
    data: ChangeEmailVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    修改邮箱第二步：验证验证码并更新邮箱。

    功能说明：
    - 验证验证码是否有效（未过期、未使用、输错次数未超限）
    - 更新用户邮箱
    - 标记验证码为已使用

    Args:
        data: 新邮箱地址 + 6位验证码
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        更新后的用户信息
    """
    # 再次检查新邮箱是否已被其他用户使用
    existing = db.query(User).filter(
        User.email == data.new_email,
        User.id != current_user.id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被其他账号使用"
        )

    # 计算验证码哈希
    code_hash = hashlib.sha256(data.verification_code.encode()).hexdigest()

    # 查找验证码记录
    reset_record = db.query(PasswordResetCode).filter(
        PasswordResetCode.email == data.new_email,
        PasswordResetCode.code_hash == code_hash,
        PasswordResetCode.is_used == False
    ).first()

    if not reset_record:
        # 验证码错误，增加输错次数
        existing_record = db.query(PasswordResetCode).filter(
            PasswordResetCode.email == data.new_email,
            PasswordResetCode.is_used == False,
            PasswordResetCode.expired_at > datetime.now()
        ).first()

        if existing_record:
            existing_record.retry_count += 1
            db.commit()

            if existing_record.retry_count >= 5:
                existing_record.is_used = True
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="验证码输错次数已达上限，该验证码已报废，请重新获取。"
                )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效、已过期或已被重复使用，请重新获取。"
        )

    # 检查验证码是否已过期
    if datetime.now() > reset_record.expired_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码已过期，请重新获取。"
        )

    # 检查输错次数
    if reset_record.retry_count >= 5:
        reset_record.is_used = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码输错次数已达上限，该验证码已报废，请重新获取。"
        )

    # 更新邮箱并标记验证码为已使用
    current_user.email = data.new_email
    reset_record.is_used = True
    db.commit()
    db.refresh(current_user)

    return current_user


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    上传用户头像接口

    功能说明：
    - 支持 jpg / png 格式
    - 文件大小限制 2MB
    - 自动裁剪为正方形缩略图（保持原始比例居中裁剪）

    Args:
        file: 头像图片文件
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        { avatar_url: str }
    """
    # 验证文件类型
    ALLOWED_TYPES = {"image/jpeg", "image/png", "image/jpg"}
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 JPG / PNG 格式的头像"
        )

    # 读取文件内容并验证大小
    content = await file.read()
    MAX_SIZE = 2 * 1024 * 1024  # 2MB
    if len(content) > MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像文件不能超过 2MB"
        )

    # 确定文件扩展名
    ext = ".jpg" if file.content_type in ("image/jpeg", "image/jpg") else ".png"

    # 存储到 uploads/avatars/ 目录
    avatar_dir = Path(settings.UPLOAD_DIR) / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)

    # 删除旧头像文件
    if current_user.avatar_url:
        old_path = Path(settings.UPLOAD_DIR) / current_user.avatar_url.lstrip("/")
        if old_path.exists():
            os.remove(old_path)

    # 保存新头像
    filename = f"{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
    avatar_path = avatar_dir / filename
    with open(avatar_path, "wb") as f:
        f.write(content)

    # 更新数据库
    avatar_url = f"/uploads/avatars/{filename}"
    current_user.avatar_url = avatar_url
    db.commit()
    db.refresh(current_user)

    return {"avatar_url": avatar_url}


@router.post("/forgot-password/send-code", response_model=ForgotPasswordResponse)
async def forgot_password_send_code(data: ForgotPasswordApply, db: Session = Depends(get_db)):
    """
    忘记密码第一步：发送验证码
    
    功能说明：
    - 验证邮箱是否存在（不存在也返回相同消息，防止邮箱枚举攻击）
    - 生成 6 位数字验证码
    - 存储 SHA-256 哈希值（严禁明文存储）
    - 新码熔断旧码：将同一邮箱所有未使用的旧验证码标记为已使用
    - 验证码有效期 10 分钟
    - 通过 SMTP 邮件服务发送验证码（支持沙盒模式）
    
    Args:
        data: 忘记密码申请数据（email）
        db: 数据库会话
        
    Returns:
        统一模糊提示消息
    """
    # 域名严格校验（拦截 .comm 等明显拼写错误，不泄露邮箱是否已注册）
    is_valid, error_message = validate_email_domain(data.email)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )

    # 查找用户（即使不存在也返回相同消息，防止邮箱枚举攻击）
    user = db.query(User).filter(User.email == data.email).first()

    if user:
        # 新码熔断旧码：将同一邮箱所有未使用且未过期的旧验证码标记为已使用
        db.query(PasswordResetCode).filter(
            PasswordResetCode.email == data.email,
            PasswordResetCode.is_used == False,
            PasswordResetCode.expired_at > datetime.now()
        ).update({"is_used": True})
        
        # 生成 6 位数字验证码
        verification_code = ''.join(random.choices(string.digits, k=6))
        
        # 计算 SHA-256 哈希值（严禁明文存储）
        code_hash = hashlib.sha256(verification_code.encode()).hexdigest()
        
        # 计算过期时间（当前时间 + 10分钟）
        expired_at = datetime.now() + timedelta(minutes=10)
        
        # 创建验证码记录
        reset_code = PasswordResetCode(
            email=data.email,
            code_hash=code_hash,
            retry_count=0,
            is_used=False,
            expired_at=expired_at
        )
        db.add(reset_code)
        db.commit()
        
        # 发送验证码邮件
        # 邮件服务会根据环境变量 MAIL_SANDBOX_MODE 决定是真实发送还是写入本地文件
        email_sent = send_verification_email(data.email, verification_code)
        
        if not email_sent:
            logger.error(f"Failed to send verification email to {data.email}")
            # 即使邮件发送失败，也不泄露用户信息，返回统一提示
    
    # 返回统一模糊提示，防止攻击者通过接口枚举已注册邮箱
    return ForgotPasswordResponse(
        status="success",
        message="验证码已成功发送至您的注册邮箱，请在 10 分钟内完成验证修改。"
    )


@router.post("/forgot-password/reset-with-code", response_model=ForgotPasswordResponse)
async def forgot_password_reset_with_code(data: ForgotPasswordReset, db: Session = Depends(get_db)):
    """
    忘记密码第二步：使用验证码重置密码
    
    功能说明：
    - 验证验证码是否有效（未过期、未使用、输错次数未超限）
    - 验证密码复杂度（8-20位，包含大写、小写、数字、特殊符号中的至少三种）
    - 更新用户密码并标记验证码为已使用
    - 所有操作在同一事务中执行
    
    Args:
        data: 重置密码数据（email, verification_code, new_password）
        db: 数据库会话
        
    Returns:
        重置成功消息
    """
    # 验证密码复杂度
    if not PASSWORD_COMPLEXITY_REGEX.match(data.new_password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="密码复杂度未达标。新密码长度需在8-20位之间，且必须同时包含大写字母、小写字母、数字及特殊符号中的至少三种。"
        )
    
    # 在同一事务中执行所有操作
    try:
        # 计算验证码的 SHA-256 哈希值
        code_hash = hashlib.sha256(data.verification_code.encode()).hexdigest()
        
        # 查找验证码记录
        reset_record = db.query(PasswordResetCode).filter(
            PasswordResetCode.email == data.email,
            PasswordResetCode.code_hash == code_hash,
            PasswordResetCode.is_used == False
        ).first()
        
        if not reset_record:
            # 验证码错误，增加输错次数（如果有匹配的邮箱记录）
            existing_record = db.query(PasswordResetCode).filter(
                PasswordResetCode.email == data.email,
                PasswordResetCode.is_used == False,
                PasswordResetCode.expired_at > datetime.now()
            ).first()
            
            if existing_record:
                existing_record.retry_count += 1
                db.commit()
                
                # 检查输错次数是否达到上限
                if existing_record.retry_count >= 5:
                    existing_record.is_used = True
                    db.commit()
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="验证码输错次数已达上限，该验证码已报废，请重新获取。"
                    )
            
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="验证码无效、已过期或已被重复使用，请重新获取。"
            )
        
        # 检查验证码是否已过期
        if datetime.now() > reset_record.expired_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="验证码已过期，请重新获取。"
            )
        
        # 检查输错次数是否达到上限
        if reset_record.retry_count >= 5:
            reset_record.is_used = True
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="验证码输错次数已达上限，该验证码已报废，请重新获取。"
            )
        
        # 查找用户
        user = db.query(User).filter(User.email == data.email).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="用户不存在"
            )
        
        # 更新密码哈希并标记验证码为已使用
        user.password_hash = get_password_hash(data.new_password)
        reset_record.is_used = True
        
        # 提交事务
        db.commit()
        
        return ForgotPasswordResponse(
            status="success",
            message="密码修改成功，原验证码已失效销毁。请使用新密码重新登录。"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码重置失败，请重试"
        )