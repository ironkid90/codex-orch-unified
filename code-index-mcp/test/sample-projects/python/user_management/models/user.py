"""
User model extending Person for the user management system.
"""

from typing import Optional, Dict, Any, Set
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import hashlib
import secrets

from .person import Person


class UserRole(Enum):
    """User role enumeration."""
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"


class UserStatus(Enum):
    """User status enumeration."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    DELETED = "deleted"


@dataclass
class User(Person):
    """User class extending Person with authentication and permissions."""
    
    username: str = ""
    password_hash: str = ""
    role: UserRole = UserRole.USER
    status: UserStatus = UserStatus.ACTIVE
    last_login: Optional[datetime] = None
    login_attempts: int = 0
    permissions: Set[str] = field(default_factory=set)
    
    def __post_init__(self):
        """Validate user data after initialization."""
        super().__post_init__()
        if not self.username.strip():
            raise ValueError("Username cannot be empty")
        if len(self.username) < 3:
            raise ValueError("Username must be at least 3 characters long")
    
    def set_password(self, password: str) -> None:
        """Set user password with hashing."""
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters long")
        
        # Simple password hashing (in real app, use bcrypt)
        salt = secrets.token_hex(16)
        password_hash = hashlib.pbkdf2_hmac('sha256', 
                                          password.encode('utf-8'), 
                                          salt.encode('utf-8'), 
                                          100000)
        self.password_hash = salt + password_hash.hex()
    
    def verify_password(self, password: str) -> bool:
        """Verify password against stored hash."""
        if not self.password_hash:
            return False
        
        try:
            salt = self.password_hash[:32]
            stored_hash = self.password_hash[32:]
            
            password_hash = hashlib.pbkdf2_hmac('sha256',
                                              password.encode('utf-8'),
                                              salt.encode('utf-8'),
                                              100000)
            
            return password_hash.hex() == stored_hash
        except Exception:
            return False
    
    def add_permission(self, permission: str) -> None:
        """Add a permission to the user."""
        self.permissions.add(permission)
    
    def remove_permission(self, permission: str) -> None:
        """Remove a permission from the user."""
        self.permissions.discard(permission)
    
    def has_permission(self, permission: str) -> bool:
        """Check if user has a specific permission."""
        return permission in self.permissions
    
    def is_admin(self) -> bool:
        """Check if user is an admin."""
        return self.role == UserRole.ADMIN
    
    def is_active(self) -> bool:
        """Check if user is active."""
        return self.status == UserStatus.ACTIVE
    
    def login(self) -> bool:
        """Record a successful login."""
        if not self.is_active():
            return False
        
        self.last_login = datetime.now()
        self.login_attempts = 0
        return True
    
    def failed_login_attempt(self) -> None:
        """Record a failed login attempt."""
        self.login_attempts += 1
        if self.login_attempts >= 5:
            self.status = UserStatus.SUSPENDED
    
    def activate(self) -> None:
        """Activate the user account."""
        self.status = UserStatus.ACTIVE
        self.login_attempts = 0
    
    def deactivate(self) -> None:
        """Deactivate the user account."""
        self.status = UserStatus.INACTIVE
    
    def suspend(self) -> None:
        """Suspend the user account."""
        self.status = UserStatus.SUSPENDED
    
    def delete(self) -> None:
        """Mark the user as deleted."""
        self.status = UserStatus.DELETED
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert user to dictionary."""
        data = super().to_dict()
        data.update({
            "username": self.username,
            "role": self.role.value,
            "status": self.status.value,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "login_attempts": self.login_attempts,
            "permissions": list(self.permissions),
        })
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'User':
        """Create a User from a dictionary."""
        person_data = {k: v for k, v in data.items() 
                      if k in ["name", "age", "email", "created_at", "metadata"]}
        person = Person.from_dict(person_data)
        
        last_login = None
        if data.get("last_login"):
            last_login = datetime.fromisoformat(data["last_login"])
        
        return cls(
            name=person.name,
            age=person.age,
            email=person.email,
            created_at=person.created_at,
            metadata=person.metadata,
            username=data["username"],
            password_hash=data.get("password_hash", ""),
            role=UserRole(data.get("role", UserRole.USER.value)),
            status=UserStatus(data.get("status", UserStatus.ACTIVE.value)),
            last_login=last_login,
            login_attempts=data.get("login_attempts", 0),
            permissions=set(data.get("permissions", []))
        )
    
    def __str__(self) -> str:
        """String representation of user."""
        return f"User(username: {self.username}, name: {self.name}, role: {self.role.value})"
    
    def __repr__(self) -> str:
        """Developer representation of user."""
        return f"User(username='{self.username}', name='{self.name}', role={self.role})"

# AUTO_REINDEX_MARKER: ci_auto_reindex_test_token