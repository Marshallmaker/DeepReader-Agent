"""
File handling utilities.
"""
import hashlib
import os
from pathlib import Path
from typing import Tuple
from fastapi import UploadFile, HTTPException, status
from app.config import settings, ensure_upload_dir


def calculate_md5(file_content: bytes) -> str:
    """Calculate MD5 hash of file content."""
    return hashlib.md5(file_content).hexdigest()


def save_upload_file(file_content: bytes, filename: str, user_id: int) -> Tuple[str, str]:
    """
    Save uploaded file to disk.
    
    Args:
        file_content: File content as bytes
        filename: Original filename
        user_id: User ID for organizing files
        
    Returns:
        Tuple of (stored_path, md5_hash)
    """
    upload_dir = ensure_upload_dir()
    
    # Create user-specific directory
    user_dir = upload_dir / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    
    # Calculate MD5
    md5_hash = calculate_md5(file_content)
    
    # Generate unique filename
    file_ext = Path(filename).suffix
    stored_filename = f"{md5_hash}{file_ext}"
    stored_path = user_dir / stored_filename
    
    # Save file
    with open(stored_path, "wb") as f:
        f.write(file_content)
    
    return str(stored_path.resolve()), md5_hash


def validate_file(file: UploadFile) -> None:
    """
    Validate uploaded file.
    
    Args:
        file: Uploaded file
        
    Raises:
        HTTPException: If file validation fails
    """
    # Check file extension
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅允许上传 PDF 文件"
        )
    
    # Check file size (FastAPI handles this, but we double-check)
    # Note: file.size might not be available for all upload handlers
    # We'll check size during actual file reading


def validate_files_batch(files: list) -> None:
    """
    Validate batch of uploaded files.

    Args:
        files: List of uploaded files

    Raises:
        HTTPException: If validation fails
    """
    if len(files) > settings.MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单次批量上传最大文件数为 {settings.MAX_UPLOAD_FILES} 个"
        )

    for file in files:
        validate_file(file)


def delete_upload_file(stored_path: str) -> bool:
    """
    从磁盘删除已上传的文件。

    Args:
        stored_path: 文件存储路径

    Returns:
        True 表示删除成功，False 表示文件不存在
    """
    path = Path(stored_path)
    if path.exists():
        os.remove(path)
        return True
    return False