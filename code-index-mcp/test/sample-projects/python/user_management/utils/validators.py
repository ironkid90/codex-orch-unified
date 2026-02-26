"""
Validation utilities for user management system.
"""

import re
from typing import Optional


def validate_email(email: str) -> bool:
    """Validate email address format."""
    if not email:
        return False
    
    # Basic email validation pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_username(username: str) -> bool:
    """Validate username format."""
    if not username:
        return False
    
    # Username must be 3-20 characters, alphanumeric and underscores only
    if len(username) < 3 or len(username) > 20:
        return False
    
    pattern = r'^[a-zA-Z0-9_]+$'
    return bool(re.match(pattern, username))


def validate_password(password: str) -> tuple[bool, Optional[str]]:
    """
    Validate password strength.
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not password:
        return False, "Password cannot be empty"
    
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    
    if len(password) > 128:
        return False, "Password must be no more than 128 characters long"
    
    # Check for at least one uppercase letter
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    
    # Check for at least one lowercase letter
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    
    # Check for at least one digit
    if not re.search(r'\d', password):
        return False, "Password must contain at least one digit"
    
    # Check for at least one special character
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character"
    
    return True, None


def validate_age(age: int) -> bool:
    """Validate age value."""
    return 0 <= age <= 150


def validate_name(name: str) -> bool:
    """Validate name format."""
    if not name or not name.strip():
        return False
    
    # Name should be 1-50 characters, letters, spaces, hyphens, and apostrophes
    if len(name.strip()) > 50:
        return False
    
    pattern = r"^[a-zA-Z\s\-']+$"
    return bool(re.match(pattern, name.strip()))


def validate_phone(phone: str) -> bool:
    """Validate phone number format."""
    if not phone:
        return False
    
    # Remove all non-digit characters
    digits_only = re.sub(r'\D', '', phone)
    
    # Check if it's a valid length (10-15 digits)
    return 10 <= len(digits_only) <= 15


def sanitize_input(input_str: str) -> str:
    """Sanitize user input by removing potentially dangerous characters."""
    if not input_str:
        return ""
    
    # Remove HTML tags
    clean_str = re.sub(r'<[^>]+>', '', input_str)
    
    # Remove script tags and their content
    clean_str = re.sub(r'<script.*?</script>', '', clean_str, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove dangerous characters
    dangerous_chars = ['<', '>', '"', "'", '&', ';', '`', '|', '$', '(', ')', '{', '}', '[', ']']
    for char in dangerous_chars:
        clean_str = clean_str.replace(char, '')
    
    return clean_str.strip()


def validate_url(url: str) -> bool:
    """Validate URL format."""
    if not url:
        return False
    
    pattern = r'^https?://(?:[-\w.])+(?::[0-9]+)?(?:/[^?\s]*)?(?:\?[^#\s]*)?(?:#[^\s]*)?$'
    return bool(re.match(pattern, url))


def validate_json_string(json_str: str) -> bool:
    """Validate if a string is valid JSON."""
    try:
        import json
        json.loads(json_str)
        return True
    except (ValueError, TypeError):
        return False