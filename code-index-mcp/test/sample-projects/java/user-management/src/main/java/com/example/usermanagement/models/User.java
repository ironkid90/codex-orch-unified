package com.example.usermanagement.models;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.apache.commons.lang3.StringUtils;
import org.mindrot.jbcrypt.BCrypt;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import java.util.Objects;

/**
 * User class extending Person with authentication and authorization features.
 */
public class User extends Person {
    
    @JsonProperty("username")
    private String username;
    
    @JsonProperty("password_hash")
    private String passwordHash;
    
    @JsonProperty("role")
    private UserRole role;
    
    @JsonProperty("status")
    private UserStatus status;
    
    @JsonProperty("last_login")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime lastLogin;
    
    @JsonProperty("login_attempts")
    private int loginAttempts;
    
    @JsonProperty("permissions")
    private Set<String> permissions;
    
    /**
     * Default constructor for Jackson deserialization.
     */
    public User() {
        super();
        this.role = UserRole.USER;
        this.status = UserStatus.ACTIVE;
        this.loginAttempts = 0;
        this.permissions = new HashSet<>();
    }
    
    /**
     * Constructor with basic information.
     * 
     * @param name The user's name
     * @param age The user's age
     * @param username The username
     */
    public User(String name, int age, String username) {
        super(name, age);
        setUsername(username);
        this.role = UserRole.USER;
        this.status = UserStatus.ACTIVE;
        this.loginAttempts = 0;
        this.permissions = new HashSet<>();
    }
    
    /**
     * Constructor with email.
     * 
     * @param name The user's name
     * @param age The user's age
     * @param username The username
     * @param email The email address
     */
    public User(String name, int age, String username, String email) {
        super(name, age, email);
        setUsername(username);
        this.role = UserRole.USER;
        this.status = UserStatus.ACTIVE;
        this.loginAttempts = 0;
        this.permissions = new HashSet<>();
    }
    
    /**
     * Constructor with role.
     * 
     * @param name The user's name
     * @param age The user's age
     * @param username The username
     * @param email The email address
     * @param role The user role
     */
    public User(String name, int age, String username, String email, UserRole role) {
        this(name, age, username, email);
        this.role = role;
    }
    
    // Getters and Setters
    
    public String getUsername() {
        return username;
    }
    
    public void setUsername(String username) {
        if (StringUtils.isBlank(username)) {
            throw new IllegalArgumentException("Username cannot be null or empty");
        }
        if (username.length() < 3 || username.length() > 20) {
            throw new IllegalArgumentException("Username must be between 3 and 20 characters");
        }
        if (!username.matches("^[a-zA-Z0-9_]+$")) {
            throw new IllegalArgumentException("Username can only contain letters, numbers, and underscores");
        }
        this.username = username.trim();
    }
    
    public String getPasswordHash() {
        return passwordHash;
    }
    
    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }
    
    public UserRole getRole() {
        return role;
    }
    
    public void setRole(UserRole role) {
        this.role = role != null ? role : UserRole.USER;
    }
    
    public UserStatus getStatus() {
        return status;
    }
    
    public void setStatus(UserStatus status) {
        this.status = status != null ? status : UserStatus.ACTIVE;
    }
    
    public LocalDateTime getLastLogin() {
        return lastLogin;
    }
    
    public void setLastLogin(LocalDateTime lastLogin) {
        this.lastLogin = lastLogin;
    }
    
    public int getLoginAttempts() {
        return loginAttempts;
    }
    
    public void setLoginAttempts(int loginAttempts) {
        this.loginAttempts = Math.max(0, loginAttempts);
    }
    
    public Set<String> getPermissions() {
        return new HashSet<>(permissions);
    }
    
    public void setPermissions(Set<String> permissions) {
        this.permissions = permissions != null ? new HashSet<>(permissions) : new HashSet<>();
    }
    
    // Authentication methods
    
    /**
     * Sets the user's password using BCrypt hashing.
     * 
     * @param password The plain text password
     * @throws IllegalArgumentException if password is invalid
     */
    public void setPassword(String password) {
        if (StringUtils.isBlank(password)) {
            throw new IllegalArgumentException("Password cannot be null or empty");
        }
        if (password.length() < 8) {
            throw new IllegalArgumentException("Password must be at least 8 characters long");
        }
        
        // Hash the password with BCrypt
        this.passwordHash = BCrypt.hashpw(password, BCrypt.gensalt());
    }
    
    /**
     * Verifies a password against the stored hash.
     * 
     * @param password The plain text password to verify
     * @return true if password matches
     */
    public boolean verifyPassword(String password) {
        if (StringUtils.isBlank(password) || StringUtils.isBlank(passwordHash)) {
            return false;
        }
        
        try {
            return BCrypt.checkpw(password, passwordHash);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
    
    // Permission methods
    
    /**
     * Adds a permission to the user.
     * 
     * @param permission The permission to add
     */
    public void addPermission(String permission) {
        if (StringUtils.isNotBlank(permission)) {
            permissions.add(permission.trim());
        }
    }
    
    /**
     * Removes a permission from the user.
     * 
     * @param permission The permission to remove
     */
    public void removePermission(String permission) {
        permissions.remove(permission);
    }
    
    /**
     * Checks if the user has a specific permission.
     * 
     * @param permission The permission to check
     * @return true if user has the permission
     */
    public boolean hasPermission(String permission) {
        return permissions.contains(permission);
    }
    
    /**
     * Clears all permissions.
     */
    public void clearPermissions() {
        permissions.clear();
    }
    
    // Status and role methods
    
    /**
     * Checks if the user is an admin.
     * 
     * @return true if user is admin
     */
    public boolean isAdmin() {
        return role == UserRole.ADMIN;
    }
    
    /**
     * Checks if the user is active.
     * 
     * @return true if user is active
     */
    public boolean isActive() {
        return status == UserStatus.ACTIVE;
    }
    
    /**
     * Checks if the user is locked due to too many failed login attempts.
     * 
     * @return true if user is locked
     */
    public boolean isLocked() {
        return status == UserStatus.SUSPENDED || loginAttempts >= 5;
    }
    
    // Login methods
    
    /**
     * Records a successful login.
     * 
     * @return true if login was successful
     */
    public boolean login() {
        if (!isActive() || isLocked()) {
            return false;
        }
        
        this.lastLogin = LocalDateTime.now();
        this.loginAttempts = 0;
        return true;
    }
    
    /**
     * Records a failed login attempt.
     */
    public void failedLoginAttempt() {
        this.loginAttempts++;
        if (this.loginAttempts >= 5) {
            this.status = UserStatus.SUSPENDED;
        }
    }
    
    /**
     * Resets login attempts.
     */
    public void resetLoginAttempts() {
        this.loginAttempts = 0;
    }
    
    // Status change methods
    
    /**
     * Activates the user account.
     */
    public void activate() {
        this.status = UserStatus.ACTIVE;
        this.loginAttempts = 0;
    }
    
    /**
     * Deactivates the user account.
     */
    public void deactivate() {
        this.status = UserStatus.INACTIVE;
    }
    
    /**
     * Suspends the user account.
     */
    public void suspend() {
        this.status = UserStatus.SUSPENDED;
    }
    
    /**
     * Marks the user as deleted.
     */
    public void delete() {
        this.status = UserStatus.DELETED;
    }
    
    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        if (!super.equals(obj)) return false;
        
        User user = (User) obj;
        return loginAttempts == user.loginAttempts &&
               Objects.equals(username, user.username) &&
               Objects.equals(passwordHash, user.passwordHash) &&
               role == user.role &&
               status == user.status &&
               Objects.equals(lastLogin, user.lastLogin) &&
               Objects.equals(permissions, user.permissions);
    }
    
    @Override
    public int hashCode() {
        return Objects.hash(super.hashCode(), username, passwordHash, role, status, 
                           lastLogin, loginAttempts, permissions);
    }
    
    @Override
    public String toString() {
        return String.format("User{username='%s', name='%s', role=%s, status=%s, lastLogin=%s}", 
                           username, getName(), role, status, lastLogin);
    }
}