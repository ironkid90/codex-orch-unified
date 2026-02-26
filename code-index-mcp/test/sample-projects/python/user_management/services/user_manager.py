"""
User management service for handling user operations.
"""

from typing import List, Optional, Dict, Any, Callable
from datetime import datetime
import json
import os

from ..models.user import User, UserRole, UserStatus
from ..utils.validators import validate_email, validate_username
from ..utils.exceptions import UserNotFoundError, DuplicateUserError


class UserManager:
    """Service class for managing users."""
    
    def __init__(self, storage_path: Optional[str] = None):
        """Initialize the user manager with optional storage path."""
        self._users: Dict[str, User] = {}
        self._storage_path = storage_path
        if storage_path and os.path.exists(storage_path):
            self._load_from_file()
    
    def create_user(self, name: str, age: int, username: str, 
                   email: Optional[str] = None, 
                   role: UserRole = UserRole.USER) -> User:
        """Create a new user."""
        if username in self._users:
            raise DuplicateUserError(f"User with username '{username}' already exists")
        
        # Validate inputs
        if not validate_username(username):
            raise ValueError("Invalid username format")
        
        if email and not validate_email(email):
            raise ValueError("Invalid email format")
        
        user = User(
            name=name,
            age=age,
            username=username,
            email=email,
            role=role
        )
        
        self._users[username] = user
        self._save_to_file()
        return user
    
    def get_user(self, username: str) -> User:
        """Get a user by username."""
        if username not in self._users:
            raise UserNotFoundError(f"User with username '{username}' not found")
        return self._users[username]
    
    def get_user_by_email(self, email: str) -> Optional[User]:
        """Get a user by email address."""
        for user in self._users.values():
            if user.email == email:
                return user
        return None
    
    def update_user(self, username: str, **kwargs) -> User:
        """Update user information."""
        user = self.get_user(username)
        
        # Update allowed fields
        allowed_fields = ['name', 'age', 'email', 'role', 'status']
        for field, value in kwargs.items():
            if field in allowed_fields and hasattr(user, field):
                setattr(user, field, value)
        
        self._save_to_file()
        return user
    
    def delete_user(self, username: str) -> bool:
        """Delete a user (soft delete)."""
        user = self.get_user(username)
        user.delete()
        self._save_to_file()
        return True
    
    def remove_user(self, username: str) -> bool:
        """Remove a user completely from the system."""
        if username not in self._users:
            raise UserNotFoundError(f"User with username '{username}' not found")
        
        del self._users[username]
        self._save_to_file()
        return True
    
    def get_all_users(self) -> List[User]:
        """Get all users."""
        return list(self._users.values())
    
    def get_active_users(self) -> List[User]:
        """Get all active users."""
        return [user for user in self._users.values() if user.is_active()]
    
    def get_users_by_role(self, role: UserRole) -> List[User]:
        """Get users by role."""
        return [user for user in self._users.values() if user.role == role]
    
    def filter_users(self, filter_func: Callable[[User], bool]) -> List[User]:
        """Filter users using a custom function."""
        return [user for user in self._users.values() if filter_func(user)]
    
    def search_users(self, query: str) -> List[User]:
        """Search users by name or username."""
        query_lower = query.lower()
        return [
            user for user in self._users.values()
            if query_lower in user.name.lower() or query_lower in user.username.lower()
        ]
    
    def get_users_older_than(self, age: int) -> List[User]:
        """Get users older than specified age."""
        return self.filter_users(lambda user: user.age > age)
    
    def get_users_with_email(self) -> List[User]:
        """Get users that have email addresses."""
        return self.filter_users(lambda user: user.has_email())
    
    def get_users_with_permission(self, permission: str) -> List[User]:
        """Get users with specific permission."""
        return self.filter_users(lambda user: user.has_permission(permission))
    
    def get_user_count(self) -> int:
        """Get the total number of users."""
        return len(self._users)
    
    def get_user_stats(self) -> Dict[str, int]:
        """Get user statistics."""
        stats = {
            'total': len(self._users),
            'active': len(self.get_active_users()),
            'admin': len(self.get_users_by_role(UserRole.ADMIN)),
            'user': len(self.get_users_by_role(UserRole.USER)),
            'guest': len(self.get_users_by_role(UserRole.GUEST)),
            'with_email': len(self.get_users_with_email()),
        }
        return stats
    
    def export_users(self, format: str = 'json') -> str:
        """Export users to specified format."""
        if format.lower() == 'json':
            return self._export_to_json()
        elif format.lower() == 'csv':
            return self._export_to_csv()
        else:
            raise ValueError(f"Unsupported export format: {format}")
    
    def _export_to_json(self) -> str:
        """Export users to JSON format."""
        users_data = [user.to_dict() for user in self._users.values()]
        return json.dumps(users_data, indent=2)
    
    def _export_to_csv(self) -> str:
        """Export users to CSV format."""
        if not self._users:
            return "username,name,age,email,role,status\n"
        
        lines = ["username,name,age,email,role,status"]
        for user in self._users.values():
            line = f"{user.username},{user.name},{user.age},{user.email or ''},{user.role.value},{user.status.value}"
            lines.append(line)
        
        return "\n".join(lines)
    
    def _save_to_file(self) -> None:
        """Save users to file if storage path is set."""
        if not self._storage_path:
            return
        
        try:
            with open(self._storage_path, 'w') as f:
                json.dump(self._export_to_json(), f, indent=2)
        except Exception as e:
            print(f"Error saving users to file: {e}")
    
    def _load_from_file(self) -> None:
        """Load users from file."""
        if not self._storage_path or not os.path.exists(self._storage_path):
            return
        
        try:
            with open(self._storage_path, 'r') as f:
                data = json.load(f)
                if isinstance(data, str):
                    data = json.loads(data)
                
                for user_data in data:
                    user = User.from_dict(user_data)
                    self._users[user.username] = user
        except Exception as e:
            print(f"Error loading users from file: {e}")
    
    def clear_all_users(self) -> None:
        """Clear all users from the system."""
        self._users.clear()
        self._save_to_file()
    
    def __len__(self) -> int:
        """Return the number of users."""
        return len(self._users)
    
    def __contains__(self, username: str) -> bool:
        """Check if a username exists."""
        return username in self._users
    
    def __iter__(self):
        """Iterate over users."""
        return iter(self._users.values())
    
    def __str__(self) -> str:
        """String representation of UserManager."""
        return f"UserManager(users: {len(self._users)})"

    # CI marker method to verify auto-reindex on change
    def _ci_added_symbol_marker(self) -> str:
        return "ci_symbol_python"