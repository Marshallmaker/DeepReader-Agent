"""
AI Chat API endpoints with SSE streaming.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
import uuid
import json
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.report import Report
from app.models.chat import ChatSession, ChatMessage
from app.schemas.chat import ChatRequest, ChatHistoryResponse, ChatMessageResponse
from app.utils.rate_limit import rate_limiter
from app.config import settings

router = APIRouter()


async def generate_chat_response(
    prompt: str,
    context: Optional[str],
    history: list,
    db: Session,
    user_id: int,
    session_id: str
):
    """
    Generate streaming chat response using SiliconFlow API.
    
    Args:
        prompt: User's message
        context: Document context (raw_markdown)
        history: Recent chat history
        db: Database session
        user_id: User ID
        session_id: Session ID
        
    Yields:
        SSE formatted text chunks
    """
    import httpx
    
    # Build system prompt based on context
    if context:
        system_prompt = f"""你是一个专业的金融研报分析助手。请基于以下文档内容回答用户问题：

文档内容：
{context[:8000]}  # Limit context to avoid token limits

请用中文回答，保持专业和准确。"""
    else:
        system_prompt = "你是一个专业的金融分析助手，可以帮助用户解答关于金融、投资、财报分析等问题。请用中文回答。"
    
    # Build messages for API
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add recent history (last 5 rounds = 10 messages)
    for msg in history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})
    
    # Add current prompt
    messages.append({"role": "user", "content": prompt})
    
    # Save user message
    user_msg = ChatMessage(
        session_id=int(session_id.split('_')[-1]) if '_' in session_id else 0,
        role="user",
        content=prompt
    )
    # Note: We need to get the actual session_id from database
    
    # Call SiliconFlow API with streaming
    async with httpx.AsyncClient() as client:
        try:
            async with client.stream(
                "POST",
                f"{settings.SILICONFLOW_API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.SILICONFLOW_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": settings.SILICONFLOW_MODEL,
                    "messages": messages,
                    "stream": True,
                    "temperature": 0.7,
                    "max_tokens": 2000
                },
                timeout=60.0
            ) as response:
                if response.status_code != 200:
                    yield f"data: {json.dumps({'error': 'API request failed'})}\n\n"
                    return
                
                full_response = ""
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            if chunk.get("choices") and chunk["choices"][0].get("delta", {}).get("content"):
                                content = chunk["choices"][0]["delta"]["content"]
                                full_response += content
                                yield f"data: {json.dumps({'content': content})}\n\n"
                        except json.JSONDecodeError:
                            continue
                
                # Save assistant response to database
                # This would be done after streaming completes
                yield "data: [DONE]\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    AI Chat streaming endpoint using SSE.
    
    - Supports single report context injection
    - Falls back to general knowledge mode when no report is bound
    - Implements rate limiting (10 messages per minute)
    - Returns SSE stream with typing effect
    """
    # Rate limiting
    rate_limiter.check_rate_limit(f"chat_{current_user.id}")
    
    # Get or create session
    session = db.query(ChatSession).filter(
        ChatSession.session_id == request.session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        # 如果提供了 report_id，必须先验证报告属于当前用户
        if request.report_id:
            report = db.query(Report).filter(
                Report.id == request.report_id,
                Report.batch.has(user_id=current_user.id)
            ).first()
            if not report:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="报告不存在或无权访问"
                )
        session = ChatSession(
            session_id=request.session_id,
            user_id=current_user.id,
            report_id=request.report_id
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    
    # Get document context if report_id is provided
    context = None
    if request.report_id:
        report = db.query(Report).filter(
            Report.id == request.report_id,
            Report.batch.has(user_id=current_user.id)
        ).first()
        if report and report.raw_markdown:
            context = report.raw_markdown
    
    # Get recent history (last 5 rounds)
    history = db.query(ChatMessage).filter(
        ChatMessage.session_id == session.id
    ).order_by(ChatMessage.created_at.desc()).limit(10).all()
    history.reverse()  # Oldest first
    
    # Save user message
    user_msg = ChatMessage(
        session_id=session.id,
        role="user",
        content=request.prompt
    )
    db.add(user_msg)
    db.commit()
    
    # Return streaming response
    return StreamingResponse(
        generate_chat_response(
            prompt=request.prompt,
            context=context,
            history=history,
            db=db,
            user_id=current_user.id,
            session_id=request.session_id
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/history/{session_id}", response_model=ChatHistoryResponse)
async def get_chat_history(
    session_id: str,
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get chat history for a session.
    """
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="聊天会话不存在"
        )
    
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session.id
    ).order_by(ChatMessage.created_at.desc()).limit(limit).all()
    
    return ChatHistoryResponse(
        session_id=session_id,
        report_id=session.report_id,
        messages=[
            ChatMessageResponse(
                id=msg.id,
                session_id=session_id,
                role=msg.role,
                content=msg.content,
                created_at=msg.created_at
            )
            for msg in reversed(messages)
        ]
    )