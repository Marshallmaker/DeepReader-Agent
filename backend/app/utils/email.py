"""
Email utility module for sending emails using SMTP.
Supports both real SMTP delivery and sandbox mode for development.
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from datetime import datetime
from pathlib import Path
import logging

from app.config import settings

# 配置日志记录器
logger = logging.getLogger(__name__)

class EmailService:
    """
    Email service for sending verification codes and other emails.
    """
    
    def __init__(
        self,
        smtp_server: str = "smtp.qq.com",
        smtp_port: int = 587,
        smtp_username: str = "",
        smtp_password: str = "",
        sender_name: str = "DeepReader",
        sandbox_mode: bool = False
    ):
        """
        Initialize email service.
        
        Args:
            smtp_server: SMTP server address
            smtp_port: SMTP server port (typically 587 for TLS)
            smtp_username: SMTP username (usually the sender email)
            smtp_password: SMTP password/app password
            sender_name: Display name for the sender
            sandbox_mode: If True, writes emails to local files instead of sending
        """
        self.smtp_server = smtp_server
        self.smtp_port = smtp_port
        self.smtp_username = smtp_username
        self.smtp_password = smtp_password
        self.sender_name = sender_name
        self.sandbox_mode = sandbox_mode
        
        # 始终创建沙盒目录（双模并行需要留底）
        self.logs_dir = Path("logs/mock_mails")
        self.logs_dir.mkdir(parents=True, exist_ok=True)
    
    def _render_html_template(self, verification_code: str) -> str:
        """
        Render the HTML template for verification code email.
        
        Args:
            verification_code: The 6-digit verification code
        
        Returns:
            HTML content as string
        """
        html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DeepReader - 密码重置验证码</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
            min-height: 100vh;
            padding: 40px 20px;
            margin: 0;
        }}
        .container {{
            max-width: 500px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #1e2a5e 0%, #7b2cbf 100%);
            padding: 30px;
            text-align: center;
        }}
        .header h1 {{
            color: white;
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }}
        .content {{
            padding: 40px 30px;
        }}
        .code-box {{
            background: linear-gradient(135deg, rgba(30, 42, 94, 0.05) 0%, rgba(123, 44, 191, 0.05) 100%);
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            margin: 20px 0;
        }}
        .code {{
            font-size: 48px;
            font-weight: 700;
            color: #1e2a5e;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
        }}
        .info {{
            color: #666;
            font-size: 14px;
            line-height: 1.6;
            text-align: center;
        }}
        .warning {{
            background: #fff9e6;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin-top: 20px;
            border-radius: 0 8px 8px 0;
        }}
        .warning p {{
            margin: 0;
            color: #856404;
            font-size: 13px;
        }}
        .footer {{
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            border-top: 1px solid #eee;
        }}
        .footer p {{
            margin: 0;
            color: #999;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 DeepReader 密码重置</h1>
        </div>
        <div class="content">
            <p class="info">
                您好！您正在尝试重置 DeepReader 账户密码。<br>
                请使用以下验证码完成验证：
            </p>
            <div class="code-box">
                <div class="code">{verification_code}</div>
            </div>
            <p class="info">
                验证码有效期为 <strong>10分钟</strong>，请在有效期内完成验证。<br>
                每个验证码最多可尝试 <strong>5次</strong>，超过次数需重新获取。
            </p>
            <div class="warning">
                <p>⚠️ 如非本人操作，请忽略此邮件。您的密码不会被更改。</p>
            </div>
        </div>
        <div class="footer">
            <p>© 2026 DeepReader. 保留所有权利。</p>
        </div>
    </div>
</body>
</html>
        """
        return html_content
    
    def _render_plain_text(self, verification_code: str) -> str:
        """
        Render plain text version of the verification email.
        
        Args:
            verification_code: The 6-digit verification code
        
        Returns:
            Plain text content as string
        """
        text_content = f"""
=====================================================
            DeepReader - 密码重置验证码
=====================================================

您好！您正在尝试重置 DeepReader 账户密码。

请使用以下验证码完成验证：

    {verification_code}

验证码有效期为 10分钟，请在有效期内完成验证。
每个验证码最多可尝试 5次，超过次数需重新获取。

如非本人操作，请忽略此邮件。您的密码不会被更改。

=====================================================
© 2026 DeepReader. 保留所有权利。
=====================================================
"""
        return text_content
    
    def send_verification_code(self, to_email: str, verification_code: str) -> bool:
        """
        发送验证码邮件（双模并行）。

        - 始终写入本地沙盒文件留底（方便开发调试和审计回溯）
        - 若未开启纯沙盒模式，同时尝试 SMTP 真实投递

        Args:
            to_email: 收件人邮箱
            verification_code: 6 位数字验证码

        Returns:
            沙盒写入成功即返回 True；SMTP 投递失败仅记日志，不影响返回
        """
        sandbox_ok = self._send_sandbox(to_email, verification_code)

        if self.sandbox_mode:
            # 纯沙盒模式：不再尝试真实发送
            return sandbox_ok

        # 双模：沙盒留底 + SMTP 真实投递
        smtp_ok = self._send_smtp(to_email, verification_code)
        if not smtp_ok:
            logger.warning(
                f"SMTP 投递失败，但验证码已存入沙盒文件，"
                f"收件人: {to_email}，验证码: {verification_code}"
            )
        return sandbox_ok
    
    def _send_sandbox(self, to_email: str, verification_code: str) -> bool:
        """
        Write email to local file (sandbox mode).
        
        Args:
            to_email: Recipient email address
            verification_code: The 6-digit verification code
        
        Returns:
            True always (sandbox mode never fails)
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{to_email.replace('@', '_').replace('.', '_')}.html"
        filepath = self.logs_dir / filename
        
        html_content = self._render_html_template(verification_code)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        logger.info(f"[SANDBOX] 验证码邮件已写入文件: {filepath}，收件人: {to_email}")
        return True
    
    def _send_smtp(self, to_email: str, verification_code: str) -> bool:
        """
        Send email via SMTP.
        
        Args:
            to_email: Recipient email address
            verification_code: The 6-digit verification code
        
        Returns:
            True if successful, False otherwise
        """
        # Validate SMTP configuration
        if not self.smtp_username or not self.smtp_password:
            logger.error("SMTP credentials not configured")
            return False
        
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = formataddr((self.sender_name, self.smtp_username))
            msg['To'] = to_email
            msg['Subject'] = "[DeepReader] 密码重置验证码"
            
            # Add plain text and HTML versions
            text_part = MIMEText(self._render_plain_text(verification_code), 'plain', 'utf-8')
            html_part = MIMEText(self._render_html_template(verification_code), 'html', 'utf-8')
            msg.attach(text_part)
            msg.attach(html_part)
            
            # 根据端口自动选择连接方式：
            # 端口 465 → 直接 SSL/TLS
            # 端口 587 → 先明文连接，再 STARTTLS 升级
            if self.smtp_port == 465:
                server = smtplib.SMTP_SSL(self.smtp_server, self.smtp_port, timeout=30)
            else:
                server = smtplib.SMTP(self.smtp_server, self.smtp_port, timeout=30)
                server.starttls()

            with server:
                server.login(self.smtp_username, self.smtp_password)
                server.sendmail(self.smtp_username, to_email, msg.as_string())
            
            logger.info(f"验证码邮件已成功发送至 {to_email}")
            return True
            
        except smtplib.SMTPAuthenticationError:
            logger.error(f"SMTP authentication failed for {self.smtp_username}")
            return False
        except smtplib.SMTPException as e:
            logger.error(f"SMTP error occurred: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending email: {str(e)}")
            return False


# Global email service instance
_email_service = None

def get_email_service() -> EmailService:
    """
    Get the global email service instance.
    
    Returns:
        EmailService instance
    """
    global _email_service
    
    if _email_service is None:
        _email_service = EmailService(
            smtp_server=settings.SMTP_SERVER,
            smtp_port=settings.SMTP_PORT,
            smtp_username=settings.SMTP_USERNAME,
            smtp_password=settings.SMTP_PASSWORD,
            sender_name=settings.SMTP_SENDER_NAME,
            sandbox_mode=settings.MAIL_SANDBOX_MODE
        )
    
    return _email_service


def send_verification_email(to_email: str, verification_code: str) -> bool:
    """
    Convenience function to send verification email.
    
    Args:
        to_email: Recipient email address
        verification_code: The 6-digit verification code
    
    Returns:
        True if successful, False otherwise
    """
    email_service = get_email_service()
    return email_service.send_verification_code(to_email, verification_code)
