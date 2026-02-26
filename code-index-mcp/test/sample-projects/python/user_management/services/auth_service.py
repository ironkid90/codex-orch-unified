"""
Authentication service for user management system.
"""

from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import secrets
import hashlib

from ..models.user import User, UserStatus
from ..utils.exceptions import AuthenticationError, UserNotFoundError


class AuthService:
    """Service class for handling authentication operations."""
    
    def __init__(self, user_manager):
        """Initialize the authentication service with a user manager."""
        self._user_manager = user_manager
        self._active_sessions: Dict[str, Dict[str, Any]] = {}
        self._session_timeout = timedelta(hours=24)
    
    def authenticate(self, username: str, password: str) -> Optional[User]:
        """Authenticate a user with username and password."""
        try:
            user = self._user_manager.get_user(username)
        except UserNotFoundError:
            raise AuthenticationError("Invalid username or password")
        
        if not user.is_active():
            raise AuthenticationError("User account is not active")
        
        if not user.verify_password(password):
            user.failed_login_attempt()
            raise AuthenticationError("Invalid username or password")
        
        # Successful authentication
        user.login()
        return user
    
    def create_session(self, user: User) -> str:
        """Create a new session for the authenticated user."""
        session_id = secrets.token_urlsafe(32)
        session_data = {
            'user_id': user.username,
            'created_at': datetime.now(),
            'last_activity': datetime.now(),
            'ip_address': None,  # Would be set in a real application
            'user_agent': None,  # Would be set in a real application
        }
        
        self._active_sessions[session_id] = session_data
        return session_id
    
    def validate_session(self, session_id: str) -> Optional[User]:
        """Validate a session and return the associated user."""
        if session_id not in self._active_sessions:
            return None
        
        session_data = self._active_sessions[session_id]
        
        # Check if session has expired
        if datetime.now() - session_data['last_activity'] > self._session_timeout:
            self.destroy_session(session_id)
            return None
        
        # Update last activity
        session_data['last_activity'] = datetime.now()
        
        try:
            user = self._user_manager.get_user(session_data['user_id'])
            if not user.is_active():
                self.destroy_session(session_id)
                return None
            return user
        except UserNotFoundError:
            self.destroy_session(session_id)
            return None
    
    def destroy_session(self, session_id: str) -> bool:
        """Destroy a session."""
        if session_id in self._active_sessions:
            del self._active_sessions[session_id]
            return True
        return False
    
    def destroy_all_sessions(self, username: str) -> int:
        """Destroy all sessions for a specific user."""
        sessions_to_remove = []
        for session_id, session_data in self._active_sessions.items():
            if session_data['user_id'] == username:
                sessions_to_remove.append(session_id)
        
        for session_id in sessions_to_remove:
            del self._active_sessions[session_id]
        
        return len(sessions_to_remove)
    
    def get_active_sessions(self, username: str) -> List[Dict[str, Any]]:
        """Get all active sessions for a user."""
        sessions = []
        for session_id, session_data in self._active_sessions.items():
            if session_data['user_id'] == username:
                sessions.append({
                    'session_id': session_id,
                    'created_at': session_data['created_at'],
                    'last_activity': session_data['last_activity'],
                    'ip_address': session_data.get('ip_address'),
                    'user_agent': session_data.get('user_agent'),
                })
        return sessions
    
    def cleanup_expired_sessions(self) -> int:
        """Remove expired sessions and return count of removed sessions."""
        current_time = datetime.now()
        expired_sessions = []
        
        for session_id, session_data in self._active_sessions.items():
            if current_time - session_data['last_activity'] > self._session_timeout:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            del self._active_sessions[session_id]
        
        return len(expired_sessions)
    
    def change_password(self, username: str, old_password: str, new_password: str) -> bool:
        """Change a user's password."""
        user = self._user_manager.get_user(username)
        
        if not user.verify_password(old_password):
            raise AuthenticationError("Current password is incorrect")
        
        user.set_password(new_password)
        
        # Destroy all existing sessions for security
        self.destroy_all_sessions(username)
        
        return True
    
    def reset_password(self, username: str, new_password: str) -> str:
        """Reset a user's password (admin function)."""
        user = self._user_manager.get_user(username)
        
        # Generate a temporary password if none provided
        if not new_password:
            new_password = self._generate_temporary_password()
        
        user.set_password(new_password)
        
        # Destroy all existing sessions
        self.destroy_all_sessions(username)
        
        return new_password
    
    def _generate_temporary_password(self) -> str:
        """Generate a temporary password."""
        return secrets.token_urlsafe(12)
    
    def get_session_stats(self) -> Dict[str, Any]:
        """Get statistics about active sessions."""
        current_time = datetime.now()
        session_count = len(self._active_sessions)
        
        # Count sessions by age
        recent_sessions = 0  # Last hour
        old_sessions = 0     # Older than 1 hour
        
        for session_data in self._active_sessions.values():
            age = current_time - session_data['last_activity']
            if age < timedelta(hours=1):
                recent_sessions += 1
            else:
                old_sessions += 1
        
        return {
            'total_sessions': session_count,
            'recent_sessions': recent_sessions,
            'old_sessions': old_sessions,
            'session_timeout_hours': self._session_timeout.total_seconds() / 3600,
        }
    
    def __str__(self) -> str:
        """String representation of AuthService."""
        return f"AuthService(active_sessions: {len(self._active_sessions)})"