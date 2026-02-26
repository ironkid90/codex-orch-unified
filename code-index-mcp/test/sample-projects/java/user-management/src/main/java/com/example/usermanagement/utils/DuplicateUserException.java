package com.example.usermanagement.utils;

/**
 * Exception thrown when attempting to create a user that already exists.
 */
public class DuplicateUserException extends RuntimeException {
    
    /**
     * Constructs a new DuplicateUserException with the specified detail message.
     * 
     * @param message the detail message
     */
    public DuplicateUserException(String message) {
        super(message);
    }
    
    /**
     * Constructs a new DuplicateUserException with the specified detail message and cause.
     * 
     * @param message the detail message
     * @param cause the cause
     */
    public DuplicateUserException(String message, Throwable cause) {
        super(message, cause);
    }
}