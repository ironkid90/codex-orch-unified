package com.example.usermanagement.models;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Enumeration for user roles in the system.
 */
public enum UserRole {
    
    /**
     * Administrator role with full system access.
     */
    ADMIN("admin", "Administrator", "Full system access"),
    
    /**
     * Regular user role with standard permissions.
     */
    USER("user", "User", "Standard user permissions"),
    
    /**
     * Guest role with limited permissions.
     */
    GUEST("guest", "Guest", "Limited guest permissions");
    
    private final String code;
    private final String displayName;
    private final String description;
    
    /**
     * Constructor for UserRole enum.
     * 
     * @param code The role code
     * @param displayName The display name
     * @param description The role description
     */
    UserRole(String code, String displayName, String description) {
        this.code = code;
        this.displayName = displayName;
        this.description = description;
    }
    
    /**
     * Gets the role code.
     * 
     * @return The role code
     */
    @JsonValue
    public String getCode() {
        return code;
    }
    
    /**
     * Gets the display name.
     * 
     * @return The display name
     */
    public String getDisplayName() {
        return displayName;
    }
    
    /**
     * Gets the role description.
     * 
     * @return The role description
     */
    public String getDescription() {
        return description;
    }
    
    /**
     * Finds a UserRole by its code.
     * 
     * @param code The role code to search for
     * @return The UserRole or null if not found
     */
    public static UserRole fromCode(String code) {
        if (code == null) {
            return null;
        }
        
        for (UserRole role : values()) {
            if (role.code.equalsIgnoreCase(code)) {
                return role;
            }
        }
        return null;
    }
    
    /**
     * Checks if this role has higher privilege than another role.
     * 
     * @param other The other role to compare with
     * @return true if this role has higher privilege
     */
    public boolean hasHigherPrivilegeThan(UserRole other) {
        return this.ordinal() < other.ordinal();
    }
    
    /**
     * Checks if this role has lower privilege than another role.
     * 
     * @param other The other role to compare with
     * @return true if this role has lower privilege
     */
    public boolean hasLowerPrivilegeThan(UserRole other) {
        return this.ordinal() > other.ordinal();
    }
    
    /**
     * Checks if this role can perform actions on another role.
     * 
     * @param targetRole The target role
     * @return true if this role can act on the target role
     */
    public boolean canActOn(UserRole targetRole) {
        // Admin can act on all roles
        if (this == ADMIN) {
            return true;
        }
        
        // Users can only act on guests
        if (this == USER) {
            return targetRole == GUEST;
        }
        
        // Guests cannot act on anyone
        return false;
    }
    
    @Override
    public String toString() {
        return displayName;
    }
}