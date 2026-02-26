package com.example.usermanagement.models;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Enumeration for user status in the system.
 */
public enum UserStatus {
    
    /**
     * Active status - user can login and use the system.
     */
    ACTIVE("active", "Active", "User can login and use the system"),
    
    /**
     * Inactive status - user account is temporarily disabled.
     */
    INACTIVE("inactive", "Inactive", "User account is temporarily disabled"),
    
    /**
     * Suspended status - user account is suspended due to violations.
     */
    SUSPENDED("suspended", "Suspended", "User account is suspended due to violations"),
    
    /**
     * Deleted status - user account is marked for deletion.
     */
    DELETED("deleted", "Deleted", "User account is marked for deletion");
    
    private final String code;
    private final String displayName;
    private final String description;
    
    /**
     * Constructor for UserStatus enum.
     * 
     * @param code The status code
     * @param displayName The display name
     * @param description The status description
     */
    UserStatus(String code, String displayName, String description) {
        this.code = code;
        this.displayName = displayName;
        this.description = description;
    }
    
    /**
     * Gets the status code.
     * 
     * @return The status code
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
     * Gets the status description.
     * 
     * @return The status description
     */
    public String getDescription() {
        return description;
    }
    
    /**
     * Finds a UserStatus by its code.
     * 
     * @param code The status code to search for
     * @return The UserStatus or null if not found
     */
    public static UserStatus fromCode(String code) {
        if (code == null) {
            return null;
        }
        
        for (UserStatus status : values()) {
            if (status.code.equalsIgnoreCase(code)) {
                return status;
            }
        }
        return null;
    }
    
    /**
     * Checks if this status allows user login.
     * 
     * @return true if user can login with this status
     */
    public boolean allowsLogin() {
        return this == ACTIVE;
    }
    
    /**
     * Checks if this status indicates the user is disabled.
     * 
     * @return true if user is disabled
     */
    public boolean isDisabled() {
        return this == INACTIVE || this == SUSPENDED || this == DELETED;
    }
    
    /**
     * Checks if this status indicates the user is deleted.
     * 
     * @return true if user is deleted
     */
    public boolean isDeleted() {
        return this == DELETED;
    }
    
    /**
     * Checks if this status can be changed to another status.
     * 
     * @param targetStatus The target status
     * @return true if status change is allowed
     */
    public boolean canChangeTo(UserStatus targetStatus) {
        // Cannot change from deleted status
        if (this == DELETED) {
            return false;
        }
        
        // Cannot change to same status
        if (this == targetStatus) {
            return false;
        }
        
        // All other changes are allowed
        return true;
    }
    
    @Override
    public String toString() {
        return displayName;
    }
}