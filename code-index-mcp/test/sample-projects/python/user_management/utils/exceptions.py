"""
Custom exceptions for user management system.
"""


class UserManagementError(Exception):
    """Base exception for user management errors."""
    pass


class UserNotFoundError(UserManagementError):
    """Exception raised when a user is not found."""
    
    def __init__(self, message: str = "User not found"):
        self.message = message
        super().__init__(self.message)


class DuplicateUserError(UserManagementError):
    """Exception raised when trying to create a user that already exists."""
    
    def __init__(self, message: str = "User already exists"):
        self.message = message
        super().__init__(self.message)


class AuthenticationError(UserManagementError):
    """Exception raised when authentication fails."""
    
    def __init__(self, message: str = "Authentication failed"):
        self.message = message
        super().__init__(self.message)


class AuthorizationError(UserManagementError):
    """Exception raised when authorization fails."""
    
    def __init__(self, message: str = "Authorization failed"):
        self.message = message
        super().__init__(self.message)


class ValidationError(UserManagementError):
    """Exception raised when validation fails."""
    
    def __init__(self, message: str = "Validation failed"):
        self.message = message
        super().__init__(self.message)


class PermissionError(UserManagementError):
    """Exception raised when user lacks required permissions."""
    
    def __init__(self, message: str = "Permission denied"):
        self.message = message
        super().__init__(self.message)


class SessionError(UserManagementError):
    """Exception raised when session operations fail."""
    
    def __init__(self, message: str = "Session error"):
        self.message = message
        super().__init__(self.message)


class StorageError(UserManagementError):
    """Exception raised when storage operations fail."""
    
    def __init__(self, message: str = "Storage error"):
        self.message = message
        super().__init__(self.message)


class ConfigurationError(UserManagementError):
    """Exception raised when configuration is invalid."""
    
    def __init__(self, message: str = "Configuration error"):
        self.message = message
        super().__init__(self.message)