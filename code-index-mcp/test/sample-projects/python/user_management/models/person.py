"""
Person model for the user management system.
"""

from typing import Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
import json


@dataclass
class Person:
    """Represents a person with basic information."""
    
    name: str
    age: int
    email: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """Validate data after initialization."""
        if self.age < 0:
            raise ValueError("Age cannot be negative")
        if self.age > 150:
            raise ValueError("Age cannot be greater than 150")
        if not self.name.strip():
            raise ValueError("Name cannot be empty")
    
    def greet(self) -> str:
        """Return a greeting message."""
        return f"Hello, I'm {self.name} and I'm {self.age} years old."
    
    def has_email(self) -> bool:
        """Check if person has an email address."""
        return self.email is not None and self.email.strip() != ""
    
    def update_email(self, email: str) -> None:
        """Update the person's email address."""
        if not email.strip():
            raise ValueError("Email cannot be empty")
        self.email = email.strip()
    
    def add_metadata(self, key: str, value: Any) -> None:
        """Add metadata to the person."""
        self.metadata[key] = value
    
    def get_metadata(self, key: str, default: Any = None) -> Any:
        """Get metadata value by key."""
        return self.metadata.get(key, default)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert person to dictionary."""
        return {
            "name": self.name,
            "age": self.age,
            "email": self.email,
            "created_at": self.created_at.isoformat(),
            "metadata": self.metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Person':
        """Create a Person from a dictionary."""
        created_at = datetime.fromisoformat(data.get("created_at", datetime.now().isoformat()))
        return cls(
            name=data["name"],
            age=data["age"],
            email=data.get("email"),
            created_at=created_at,
            metadata=data.get("metadata", {})
        )
    
    def to_json(self) -> str:
        """Convert person to JSON string."""
        return json.dumps(self.to_dict(), indent=2)
    
    @classmethod
    def from_json(cls, json_str: str) -> 'Person':
        """Create a Person from JSON string."""
        data = json.loads(json_str)
        return cls.from_dict(data)
    
    def __str__(self) -> str:
        """String representation of person."""
        email_str = f", email: {self.email}" if self.has_email() else ""
        return f"Person(name: {self.name}, age: {self.age}{email_str})"
    
    def __repr__(self) -> str:
        """Developer representation of person."""
        return f"Person(name='{self.name}', age={self.age}, email='{self.email}')"