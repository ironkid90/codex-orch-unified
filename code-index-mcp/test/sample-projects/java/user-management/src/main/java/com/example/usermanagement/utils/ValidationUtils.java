package com.example.usermanagement.utils;

import org.apache.commons.lang3.StringUtils;

/**
 * Utility class for validation operations.
 */
public final class ValidationUtils {
    
    private static final String EMAIL_PATTERN = "^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$";
    private static final String USERNAME_PATTERN = "^[a-zA-Z0-9_]+$";
    
    /**
     * Private constructor to prevent instantiation.
     */
    private ValidationUtils() {
        throw new UnsupportedOperationException("Utility class cannot be instantiated");
    }
    
    /**
     * Validates email format.
     * 
     * @param email The email to validate
     * @throws IllegalArgumentException if email is invalid
     */
    public static void validateEmail(String email) {
        if (StringUtils.isBlank(email)) {
            throw new IllegalArgumentException("Email cannot be null or empty");
        }
        
        if (!email.matches(EMAIL_PATTERN)) {
            throw new IllegalArgumentException("Invalid email format");
        }
    }
    
    /**
     * Validates username format.
     * 
     * @param username The username to validate
     * @throws IllegalArgumentException if username is invalid
     */
    public static void validateUsername(String username) {
        if (StringUtils.isBlank(username)) {
            throw new IllegalArgumentException("Username cannot be null or empty");
        }
        
        if (username.length() < 3 || username.length() > 20) {
            throw new IllegalArgumentException("Username must be between 3 and 20 characters");
        }
        
        if (!username.matches(USERNAME_PATTERN)) {
            throw new IllegalArgumentException("Username can only contain letters, numbers, and underscores");
        }
    }
    
    /**
     * Checks if email format is valid.
     * 
     * @param email The email to check
     * @return true if email is valid
     */
    public static boolean isValidEmail(String email) {
        return StringUtils.isNotBlank(email) && email.matches(EMAIL_PATTERN);
    }
    
    /**
     * Checks if username format is valid.
     * 
     * @param username The username to check
     * @return true if username is valid
     */
    public static boolean isValidUsername(String username) {
        return StringUtils.isNotBlank(username) && 
               username.length() >= 3 && 
               username.length() <= 20 && 
               username.matches(USERNAME_PATTERN);
    }
}