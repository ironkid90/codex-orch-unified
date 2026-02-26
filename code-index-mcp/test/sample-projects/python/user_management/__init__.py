"""
User Management System

A sample application for testing Code Index MCP's Python analysis capabilities.
"""

__version__ = "0.1.0"
__author__ = "Test Author"

from .models.person import Person
from .models.user import User
from .services.user_manager import UserManager

__all__ = ["Person", "User", "UserManager"]