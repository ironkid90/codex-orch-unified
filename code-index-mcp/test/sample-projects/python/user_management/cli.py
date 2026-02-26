"""
Command line interface for user management system.
"""

import click
import json
from typing import Optional

from .services.user_manager import UserManager
from .services.auth_service import AuthService
from .models.user import UserRole, UserStatus
from .utils.exceptions import UserNotFoundError, DuplicateUserError


@click.group()
@click.pass_context
def cli(ctx):
    """User Management System CLI."""
    ctx.ensure_object(dict)
    ctx.obj['user_manager'] = UserManager()
    ctx.obj['auth_service'] = AuthService(ctx.obj['user_manager'])


@cli.command()
@click.option('--name', required=True, help='Full name of the user')
@click.option('--username', required=True, help='Username for the user')
@click.option('--age', required=True, type=int, help='Age of the user')
@click.option('--email', help='Email address of the user')
@click.option('--role', type=click.Choice(['user', 'admin', 'guest']), default='user', help='Role of the user')
@click.option('--password', prompt=True, hide_input=True, help='Password for the user')
@click.pass_context
def create_user(ctx, name: str, username: str, age: int, email: Optional[str], role: str, password: str):
    """Create a new user."""
    try:
        user_manager = ctx.obj['user_manager']
        user_role = UserRole(role)
        
        user = user_manager.create_user(
            name=name,
            username=username,
            age=age,
            email=email,
            role=user_role
        )
        
        user.set_password(password)
        
        click.echo(f"User '{username}' created successfully!")
        click.echo(f"Name: {user.name}")
        click.echo(f"Age: {user.age}")
        click.echo(f"Email: {user.email or 'Not provided'}")
        click.echo(f"Role: {user.role.value}")
        
    except DuplicateUserError as e:
        click.echo(f"Error: {e}", err=True)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)


@cli.command()
@click.argument('username')
@click.pass_context
def get_user(ctx, username: str):
    """Get information about a user."""
    try:
        user_manager = ctx.obj['user_manager']
        user = user_manager.get_user(username)
        
        click.echo(f"Username: {user.username}")
        click.echo(f"Name: {user.name}")
        click.echo(f"Age: {user.age}")
        click.echo(f"Email: {user.email or 'Not provided'}")
        click.echo(f"Role: {user.role.value}")
        click.echo(f"Status: {user.status.value}")
        click.echo(f"Created: {user.created_at}")
        click.echo(f"Last Login: {user.last_login or 'Never'}")
        click.echo(f"Permissions: {', '.join(user.permissions) if user.permissions else 'None'}")
        
    except UserNotFoundError as e:
        click.echo(f"Error: {e}", err=True)


@cli.command()
@click.pass_context
def list_users(ctx):
    """List all users."""
    user_manager = ctx.obj['user_manager']
    users = user_manager.get_all_users()
    
    if not users:
        click.echo("No users found.")
        return
    
    click.echo(f"Found {len(users)} users:")
    click.echo("-" * 60)
    
    for user in users:
        status_indicator = "✓" if user.is_active() else "✗"
        click.echo(f"{status_indicator} {user.username:<15} {user.name:<20} {user.role.value:<10} {user.email or 'No email'}")


@cli.command()
@click.argument('username')
@click.option('--name', help='New name for the user')
@click.option('--age', type=int, help='New age for the user')
@click.option('--email', help='New email for the user')
@click.option('--role', type=click.Choice(['user', 'admin', 'guest']), help='New role for the user')
@click.pass_context
def update_user(ctx, username: str, name: Optional[str], age: Optional[int], 
                email: Optional[str], role: Optional[str]):
    """Update user information."""
    try:
        user_manager = ctx.obj['user_manager']
        
        updates = {}
        if name:
            updates['name'] = name
        if age is not None:
            updates['age'] = age
        if email:
            updates['email'] = email
        if role:
            updates['role'] = UserRole(role)
        
        if not updates:
            click.echo("No updates provided.")
            return
        
        user = user_manager.update_user(username, **updates)
        click.echo(f"User '{username}' updated successfully!")
        
    except UserNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)


@cli.command()
@click.argument('username')
@click.confirmation_option(prompt='Are you sure you want to delete this user?')
@click.pass_context
def delete_user(ctx, username: str):
    """Delete a user."""
    try:
        user_manager = ctx.obj['user_manager']
        user_manager.delete_user(username)
        click.echo(f"User '{username}' deleted successfully!")
        
    except UserNotFoundError as e:
        click.echo(f"Error: {e}", err=True)


@cli.command()
@click.argument('username')
@click.option('--password', prompt=True, hide_input=True, help='Password for authentication')
@click.pass_context
def authenticate(ctx, username: str, password: str):
    """Authenticate a user."""
    try:
        auth_service = ctx.obj['auth_service']
        user = auth_service.authenticate(username, password)
        
        click.echo(f"Authentication successful!")
        click.echo(f"Welcome, {user.name}!")
        
        # Create a session
        session_id = auth_service.create_session(user)
        click.echo(f"Session created: {session_id}")
        
    except Exception as e:
        click.echo(f"Authentication failed: {e}", err=True)


@cli.command()
@click.pass_context
def stats(ctx):
    """Show user statistics."""
    user_manager = ctx.obj['user_manager']
    auth_service = ctx.obj['auth_service']
    
    user_stats = user_manager.get_user_stats()
    session_stats = auth_service.get_session_stats()
    
    click.echo("User Statistics:")
    click.echo(f"  Total Users: {user_stats['total']}")
    click.echo(f"  Active Users: {user_stats['active']}")
    click.echo(f"  Admin Users: {user_stats['admin']}")
    click.echo(f"  Regular Users: {user_stats['user']}")
    click.echo(f"  Guest Users: {user_stats['guest']}")
    click.echo(f"  Users with Email: {user_stats['with_email']}")
    
    click.echo("\nSession Statistics:")
    click.echo(f"  Active Sessions: {session_stats['total_sessions']}")
    click.echo(f"  Recent Sessions: {session_stats['recent_sessions']}")
    click.echo(f"  Old Sessions: {session_stats['old_sessions']}")


@cli.command()
@click.option('--format', type=click.Choice(['json', 'csv']), default='json', help='Export format')
@click.option('--output', help='Output file path')
@click.pass_context
def export(ctx, format: str, output: Optional[str]):
    """Export users to file."""
    user_manager = ctx.obj['user_manager']
    
    try:
        data = user_manager.export_users(format)
        
        if output:
            with open(output, 'w') as f:
                f.write(data)
            click.echo(f"Users exported to {output}")
        else:
            click.echo(data)
            
    except Exception as e:
        click.echo(f"Export failed: {e}", err=True)


@cli.command()
@click.argument('query')
@click.pass_context
def search(ctx, query: str):
    """Search users by name or username."""
    user_manager = ctx.obj['user_manager']
    users = user_manager.search_users(query)
    
    if not users:
        click.echo(f"No users found matching '{query}'")
        return
    
    click.echo(f"Found {len(users)} users matching '{query}':")
    click.echo("-" * 60)
    
    for user in users:
        status_indicator = "✓" if user.is_active() else "✗"
        click.echo(f"{status_indicator} {user.username:<15} {user.name:<20} {user.role.value:<10}")


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == '__main__':
    main()