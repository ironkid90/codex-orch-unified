"""
Helper utilities for user management system.
"""

import secrets
import string
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import json
import hashlib


def generate_random_string(length: int = 16, 
                          include_digits: bool = True,
                          include_symbols: bool = False) -> str:
    """Generate a random string of specified length."""
    characters = string.ascii_letters
    
    if include_digits:
        characters += string.digits
    
    if include_symbols:
        characters += "!@#$%^&*"
    
    return ''.join(secrets.choice(characters) for _ in range(length))


def generate_secure_token(length: int = 32) -> str:
    """Generate a secure URL-safe token."""
    return secrets.token_urlsafe(length)


def generate_hash(input_string: str, salt: str = "") -> str:
    """Generate a SHA-256 hash of the input string."""
    combined = f"{input_string}{salt}"
    return hashlib.sha256(combined.encode()).hexdigest()


def format_datetime(dt: datetime, format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Format datetime object to string."""
    if dt is None:
        return ""
    return dt.strftime(format_str)


def parse_datetime(date_string: str, format_str: str = "%Y-%m-%d %H:%M:%S") -> Optional[datetime]:
    """Parse string to datetime object."""
    try:
        return datetime.strptime(date_string, format_str)
    except ValueError:
        return None


def get_current_timestamp() -> str:
    """Get current timestamp as ISO format string."""
    return datetime.now(timezone.utc).isoformat()


def is_valid_json(json_string: str) -> bool:
    """Check if a string is valid JSON."""
    try:
        json.loads(json_string)
        return True
    except (ValueError, TypeError):
        return False


def deep_merge_dicts(dict1: Dict[str, Any], dict2: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two dictionaries."""
    result = dict1.copy()
    
    for key, value in dict2.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge_dicts(result[key], value)
        else:
            result[key] = value
    
    return result


def flatten_dict(nested_dict: Dict[str, Any], parent_key: str = '', sep: str = '.') -> Dict[str, Any]:
    """Flatten a nested dictionary."""
    items = []
    
    for key, value in nested_dict.items():
        new_key = f"{parent_key}{sep}{key}" if parent_key else key
        
        if isinstance(value, dict):
            items.extend(flatten_dict(value, new_key, sep=sep).items())
        else:
            items.append((new_key, value))
    
    return dict(items)


def chunk_list(input_list: List[Any], chunk_size: int) -> List[List[Any]]:
    """Split a list into chunks of specified size."""
    return [input_list[i:i + chunk_size] for i in range(0, len(input_list), chunk_size)]


def remove_duplicates(input_list: List[Any]) -> List[Any]:
    """Remove duplicates from a list while preserving order."""
    seen = set()
    result = []
    
    for item in input_list:
        if item not in seen:
            seen.add(item)
            result.append(item)
    
    return result


def safe_dict_get(dictionary: Dict[str, Any], key_path: str, default: Any = None) -> Any:
    """Safely get value from nested dictionary using dot notation."""
    keys = key_path.split('.')
    current = dictionary
    
    try:
        for key in keys:
            current = current[key]
        return current
    except (KeyError, TypeError):
        return default


def calculate_age(birth_date: datetime) -> int:
    """Calculate age from birth date."""
    today = datetime.now()
    age = today.year - birth_date.year
    
    # Adjust if birthday hasn't occurred this year
    if today.month < birth_date.month or (today.month == birth_date.month and today.day < birth_date.day):
        age -= 1
    
    return age


def mask_email(email: str) -> str:
    """Mask email address for privacy."""
    if not email or '@' not in email:
        return email
    
    username, domain = email.split('@', 1)
    
    if len(username) <= 2:
        masked_username = username
    else:
        masked_username = username[0] + '*' * (len(username) - 2) + username[-1]
    
    return f"{masked_username}@{domain}"


def format_file_size(size_bytes: int) -> str:
    """Format file size in human readable format."""
    if size_bytes == 0:
        return "0 B"
    
    size_names = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    
    while size_bytes >= 1024 and i < len(size_names) - 1:
        size_bytes /= 1024.0
        i += 1
    
    return f"{size_bytes:.1f} {size_names[i]}"


def truncate_string(text: str, max_length: int, suffix: str = "...") -> str:
    """Truncate string to specified length with optional suffix."""
    if len(text) <= max_length:
        return text
    
    return text[:max_length - len(suffix)] + suffix


def camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case."""
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


def snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    components = name.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


def is_email_domain_valid(email: str, allowed_domains: List[str]) -> bool:
    """Check if email domain is in allowed list."""
    if not email or '@' not in email:
        return False
    
    domain = email.split('@')[1].lower()
    return domain in [d.lower() for d in allowed_domains]


def get_initials(name: str) -> str:
    """Get initials from a name."""
    if not name:
        return ""
    
    words = name.strip().split()
    initials = ''.join(word[0].upper() for word in words if word)
    return initials[:3]  # Limit to 3 characters