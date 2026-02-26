package com.example.usermanagement;

import com.example.usermanagement.models.User;
import com.example.usermanagement.models.UserRole;
import com.example.usermanagement.services.UserManager;
import com.example.usermanagement.utils.UserNotFoundException;
import com.example.usermanagement.utils.DuplicateUserException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Main class demonstrating the User Management System.
 */
public class Main {
    
    private static final Logger logger = LoggerFactory.getLogger(Main.class);
    
    public static void main(String[] args) {
        System.out.println("=".repeat(50));
        System.out.println("User Management System Demo (Java)");
        System.out.println("=".repeat(50));
        
        // Create user manager
        UserManager userManager = new UserManager();
        
        // Create sample users
        System.out.println("\n1. Creating sample users...");
        createSampleUsers(userManager);
        
        // Display all users
        System.out.println("\n2. Listing all users...");
        listAllUsers(userManager);
        
        // Test user retrieval
        System.out.println("\n3. Testing user retrieval...");
        testUserRetrieval(userManager);
        
        // Test user search
        System.out.println("\n4. Testing user search...");
        testUserSearch(userManager);
        
        // Test user filtering
        System.out.println("\n5. Testing user filtering...");
        testUserFiltering(userManager);
        
        // Test user updates
        System.out.println("\n6. Testing user updates...");
        testUserUpdates(userManager);
        
        // Test authentication
        System.out.println("\n7. Testing authentication...");
        testAuthentication(userManager);
        
        // Display statistics
        System.out.println("\n8. User statistics...");
        displayStatistics(userManager);
        
        // Test export functionality
        System.out.println("\n9. Testing export functionality...");
        testExport(userManager);
        
        // Test user permissions
        System.out.println("\n10. Testing user permissions...");
        testPermissions(userManager);
        
        System.out.println("\n" + "=".repeat(50));
        System.out.println("Demo completed successfully!");
        System.out.println("=".repeat(50));
    }
    
    private static void createSampleUsers(UserManager userManager) {
        try {
            // Create admin user
            User admin = userManager.createUser("Alice Johnson", 30, "alice_admin", 
                                              "alice@example.com", UserRole.ADMIN);
            admin.setPassword("AdminPass123!");
            admin.addPermission("user_management");
            admin.addPermission("system_admin");
            
            // Create regular users
            User user1 = userManager.createUser("Bob Smith", 25, "bob_user", "bob@example.com");
            user1.setPassword("UserPass123!");
            
            User user2 = userManager.createUser("Charlie Brown", 35, "charlie", "charlie@example.com");
            user2.setPassword("CharliePass123!");
            
            User user3 = userManager.createUser("Diana Prince", 28, "diana", "diana@example.com");
            user3.setPassword("DianaPass123!");
            
            System.out.println("✓ Created " + userManager.getUserCount() + " users");
            
        } catch (DuplicateUserException e) {
            System.out.println("✗ Error creating users: " + e.getMessage());
        } catch (Exception e) {
            System.out.println("✗ Unexpected error: " + e.getMessage());
            logger.error("Error creating sample users", e);
        }
    }
    
    private static void listAllUsers(UserManager userManager) {
        List<User> users = userManager.getAllUsers();
        
        System.out.println("Found " + users.size() + " users:");
        users.forEach(user -> 
            System.out.println("  • " + user.getUsername() + " (" + user.getName() + 
                             ") - " + user.getRole().getDisplayName() + 
                             " [" + user.getStatus().getDisplayName() + "]")
        );
    }
    
    private static void testUserRetrieval(UserManager userManager) {
        try {
            User user = userManager.getUser("alice_admin");
            System.out.println("✓ Retrieved user: " + user.getUsername() + " (" + user.getName() + ")");
            
            User userByEmail = userManager.getUserByEmail("bob@example.com");
            if (userByEmail != null) {
                System.out.println("✓ Found user by email: " + userByEmail.getUsername());
            }
            
        } catch (UserNotFoundException e) {
            System.out.println("✗ User retrieval failed: " + e.getMessage());
        }
    }
    
    private static void testUserSearch(UserManager userManager) {
        List<User> searchResults = userManager.searchUsers("alice");
        System.out.println("Search results for 'alice': " + searchResults.size() + " users found");
        
        searchResults.forEach(user -> 
            System.out.println("  • " + user.getUsername() + " (" + user.getName() + ")")
        );
    }
    
    private static void testUserFiltering(UserManager userManager) {
        List<User> olderUsers = userManager.getUsersOlderThan(30);
        System.out.println("Users older than 30: " + olderUsers.size() + " users");
        
        olderUsers.forEach(user -> 
            System.out.println("  • " + user.getUsername() + " (" + user.getName() + ") - age " + user.getAge())
        );
        
        List<User> adminUsers = userManager.getUsersByRole(UserRole.ADMIN);
        System.out.println("Admin users: " + adminUsers.size() + " users");
    }
    
    private static void testUserUpdates(UserManager userManager) {
        try {
            Map<String, Object> updates = Map.of("age", 26);
            User updatedUser = userManager.updateUser("bob_user", updates);
            System.out.println("✓ Updated " + updatedUser.getUsername() + "'s age to " + updatedUser.getAge());
            
        } catch (UserNotFoundException e) {
            System.out.println("✗ Update failed: " + e.getMessage());
        }
    }
    
    private static void testAuthentication(UserManager userManager) {
        try {
            User user = userManager.getUser("alice_admin");
            
            // Test password verification
            boolean isValid = user.verifyPassword("AdminPass123!");
            System.out.println("✓ Password verification: " + (isValid ? "SUCCESS" : "FAILED"));
            
            // Test login
            boolean loginSuccess = user.login();
            System.out.println("✓ Login attempt: " + (loginSuccess ? "SUCCESS" : "FAILED"));
            
            if (loginSuccess) {
                System.out.println("✓ Last login: " + user.getLastLogin());
            }
            
        } catch (UserNotFoundException e) {
            System.out.println("✗ Authentication test failed: " + e.getMessage());
        }
    }
    
    private static void displayStatistics(UserManager userManager) {
        Map<String, Integer> stats = userManager.getUserStats();
        
        stats.forEach((key, value) -> 
            System.out.println("  " + key.replace("_", " ").toUpperCase() + ": " + value)
        );
    }
    
    private static void testExport(UserManager userManager) {
        try {
            String jsonExport = userManager.exportUsers("json");
            System.out.println("✓ JSON export: " + jsonExport.length() + " characters");
            
            String csvExport = userManager.exportUsers("csv");
            System.out.println("✓ CSV export: " + csvExport.split("\n").length + " lines");
            
        } catch (Exception e) {
            System.out.println("✗ Export failed: " + e.getMessage());
        }
    }
    
    private static void testPermissions(UserManager userManager) {
        try {
            User admin = userManager.getUser("alice_admin");
            
            System.out.println("Admin permissions: " + admin.getPermissions());
            System.out.println("Has user_management permission: " + admin.hasPermission("user_management"));
            System.out.println("Is admin: " + admin.isAdmin());
            
            // Test role privileges
            System.out.println("Admin role can act on USER role: " + 
                             admin.getRole().canActOn(UserRole.USER));
            
        } catch (UserNotFoundException e) {
            System.out.println("✗ Permission test failed: " + e.getMessage());
        }
    }
}