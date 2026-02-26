#!/usr/bin/env python3
"""
Main entry point for the user management system demo.
"""

from user_management import UserManager, Person, User
from user_management.services.auth_service import AuthService
from user_management.models.user import UserRole
from user_management.utils.exceptions import UserNotFoundError, DuplicateUserError


def main():
    """Demonstrate the user management system."""
    print("=" * 50)
    print("User Management System Demo")
    print("=" * 50)
    
    # Create user manager and auth service
    user_manager = UserManager()
    auth_service = AuthService(user_manager)
    
    # Create some sample users
    print("\n1. Creating sample users...")
    
    try:
        # Create admin user
        admin = user_manager.create_user(
            name="Alice Johnson",
            username="alice_admin",
            age=30,
            email="alice@example.com",
            role=UserRole.ADMIN
        )
        admin.set_password("AdminPass123!")
        admin.add_permission("user_management")
        admin.add_permission("system_admin")
        
        # Create regular users
        user1 = user_manager.create_user(
            name="Bob Smith",
            username="bob_user",
            age=25,
            email="bob@example.com"
        )
        user1.set_password("UserPass123!")
        
        user2 = user_manager.create_user(
            name="Charlie Brown",
            username="charlie",
            age=35,
            email="charlie@example.com"
        )
        user2.set_password("CharliePass123!")
        
        print(f"✓ Created {user_manager.get_user_count()} users")
        
    except DuplicateUserError as e:
        print(f"✗ Error creating users: {e}")
    
    # Display all users
    print("\n2. Listing all users...")
    users = user_manager.get_all_users()
    for user in users:
        print(f"  • {user.username} ({user.name}) - {user.role.value}")
    
    # Test authentication
    print("\n3. Testing authentication...")
    try:
        authenticated_user = auth_service.authenticate("alice_admin", "AdminPass123!")
        print(f"✓ Authentication successful for {authenticated_user.username}")
        
        # Create session
        session_id = auth_service.create_session(authenticated_user)
        print(f"✓ Session created: {session_id[:16]}...")
        
    except Exception as e:
        print(f"✗ Authentication failed: {e}")
    
    # Test user search
    print("\n4. Testing user search...")
    search_results = user_manager.search_users("alice")
    print(f"Search results for 'alice': {len(search_results)} users found")
    for user in search_results:
        print(f"  • {user.username} ({user.name})")
    
    # Test filtering
    print("\n5. Testing user filtering...")
    older_users = user_manager.get_users_older_than(30)
    print(f"Users older than 30: {len(older_users)} users")
    for user in older_users:
        print(f"  • {user.username} ({user.name}) - age {user.age}")
    
    # Test user updates
    print("\n6. Testing user updates...")
    try:
        updated_user = user_manager.update_user("bob_user", age=26)
        print(f"✓ Updated {updated_user.username}'s age to {updated_user.age}")
    except UserNotFoundError as e:
        print(f"✗ Update failed: {e}")
    
    # Display statistics
    print("\n7. User statistics...")
    stats = user_manager.get_user_stats()
    for key, value in stats.items():
        print(f"  {key.replace('_', ' ').title()}: {value}")
    
    # Test export functionality
    print("\n8. Testing export functionality...")
    try:
        json_export = user_manager.export_users('json')
        print(f"✓ JSON export: {len(json_export)} characters")
        
        csv_export = user_manager.export_users('csv')
        print(f"✓ CSV export: {len(csv_export.splitlines())} lines")
    except Exception as e:
        print(f"✗ Export failed: {e}")
    
    # Test password change
    print("\n9. Testing password change...")
    try:
        auth_service.change_password("bob_user", "UserPass123!", "NewUserPass123!")
        print("✓ Password changed successfully")
        
        # Test with new password
        auth_service.authenticate("bob_user", "NewUserPass123!")
        print("✓ Authentication with new password successful")
        
    except Exception as e:
        print(f"✗ Password change failed: {e}")
    
    # Test session management
    print("\n10. Testing session management...")
    session_stats = auth_service.get_session_stats()
    print(f"Active sessions: {session_stats['total_sessions']}")
    
    # Cleanup expired sessions
    expired_count = auth_service.cleanup_expired_sessions()
    print(f"Cleaned up {expired_count} expired sessions")
    
    print("\n" + "=" * 50)
    print("Demo completed successfully!")
    print("=" * 50)


if __name__ == "__main__":
    main()