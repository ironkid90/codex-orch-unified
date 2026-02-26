package com.example.usermanagement.services;

import com.example.usermanagement.models.User;
import com.example.usermanagement.models.UserRole;
import com.example.usermanagement.models.UserStatus;
import com.example.usermanagement.utils.UserNotFoundException;
import com.example.usermanagement.utils.DuplicateUserException;
import com.example.usermanagement.utils.ValidationUtils;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * Service class for managing users in the system.
 * Provides CRUD operations, search functionality, and data persistence.
 */
public class UserManager {
    
    private static final Logger logger = LoggerFactory.getLogger(UserManager.class);
    
    private final Map<String, User> users;
    private final ObjectMapper objectMapper;
    private final String storagePath;
    
    /**
     * Constructor with default storage path.
     */
    public UserManager() {
        this(null);
    }
    
    /**
     * Constructor with custom storage path.
     * 
     * @param storagePath The file path for user data storage
     */
    public UserManager(String storagePath) {
        this.users = new ConcurrentHashMap<>();
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.storagePath = storagePath;
        
        if (StringUtils.isNotBlank(storagePath)) {
            loadUsersFromFile();
        }
    }
    
    /**
     * Creates a new user in the system.
     * 
     * @param name The user's name
     * @param age The user's age
     * @param username The username
     * @param email The email address (optional)
     * @param role The user role
     * @return The created user
     * @throws DuplicateUserException if username already exists
     * @throws IllegalArgumentException if validation fails
     */
    public User createUser(String name, int age, String username, String email, UserRole role) {
        logger.debug("Creating user with username: {}", username);
        
        if (users.containsKey(username)) {
            throw new DuplicateUserException("User with username '" + username + "' already exists");
        }
        
        // Validate inputs
        ValidationUtils.validateUsername(username);
        if (StringUtils.isNotBlank(email)) {
            ValidationUtils.validateEmail(email);
        }
        
        User user = new User(name, age, username, email, role);
        users.put(username, user);
        
        saveUsersToFile();
        logger.info("User created successfully: {}", username);
        
        return user;
    }
    
    /**
     * Creates a new user with default role.
     * 
     * @param name The user's name
     * @param age The user's age
     * @param username The username
     * @param email The email address (optional)
     * @return The created user
     */
    public User createUser(String name, int age, String username, String email) {
        return createUser(name, age, username, email, UserRole.USER);
    }
    
    /**
     * Creates a new user with minimal information.
     * 
     * @param name The user's name
     * @param age The user's age
     * @param username The username
     * @return The created user
     */
    public User createUser(String name, int age, String username) {
        return createUser(name, age, username, null, UserRole.USER);
    }
    
    /**
     * Retrieves a user by username.
     * 
     * @param username The username
     * @return The user
     * @throws UserNotFoundException if user is not found
     */
    public User getUser(String username) {
        User user = users.get(username);
        if (user == null) {
            throw new UserNotFoundException("User with username '" + username + "' not found");
        }
        return user;
    }
    
    /**
     * Retrieves a user by email address.
     * 
     * @param email The email address
     * @return The user or null if not found
     */
    public User getUserByEmail(String email) {
        return users.values().stream()
                   .filter(user -> Objects.equals(user.getEmail(), email))
                   .findFirst()
                   .orElse(null);
    }
    
    /**
     * Updates user information.
     * 
     * @param username The username
     * @param updates A map of field updates
     * @return The updated user
     * @throws UserNotFoundException if user is not found
     */
    public User updateUser(String username, Map<String, Object> updates) {
        User user = getUser(username);
        
        updates.forEach((field, value) -> {
            switch (field.toLowerCase()) {
                case "name":
                    user.setName((String) value);
                    break;
                case "age":
                    user.setAge((Integer) value);
                    break;
                case "email":
                    user.setEmail((String) value);
                    break;
                case "role":
                    if (value instanceof UserRole) {
                        user.setRole((UserRole) value);
                    } else if (value instanceof String) {
                        user.setRole(UserRole.fromCode((String) value));
                    }
                    break;
                case "status":
                    if (value instanceof UserStatus) {
                        user.setStatus((UserStatus) value);
                    } else if (value instanceof String) {
                        user.setStatus(UserStatus.fromCode((String) value));
                    }
                    break;
                default:
                    logger.warn("Unknown field for update: {}", field);
            }
        });
        
        saveUsersToFile();
        logger.info("User updated successfully: {}", username);
        
        return user;
    }
    
    /**
     * Deletes a user (soft delete).
     * 
     * @param username The username
     * @return true if user was deleted
     * @throws UserNotFoundException if user is not found
     */
    public boolean deleteUser(String username) {
        User user = getUser(username);
        user.delete();
        
        saveUsersToFile();
        logger.info("User deleted successfully: {}", username);
        
        return true;
    }
    
    /**
     * Removes a user completely from the system.
     * 
     * @param username The username
     * @return true if user was removed
     * @throws UserNotFoundException if user is not found
     */
    public boolean removeUser(String username) {
        if (!users.containsKey(username)) {
            throw new UserNotFoundException("User with username '" + username + "' not found");
        }
        
        users.remove(username);
        saveUsersToFile();
        logger.info("User removed completely: {}", username);
        
        return true;
    }
    
    /**
     * Gets all users in the system.
     * 
     * @return A list of all users
     */
    public List<User> getAllUsers() {
        return new ArrayList<>(users.values());
    }
    
    /**
     * Gets all active users.
     * 
     * @return A list of active users
     */
    public List<User> getActiveUsers() {
        return users.values().stream()
                   .filter(User::isActive)
                   .collect(Collectors.toList());
    }
    
    /**
     * Gets users by role.
     * 
     * @param role The user role
     * @return A list of users with the specified role
     */
    public List<User> getUsersByRole(UserRole role) {
        return users.values().stream()
                   .filter(user -> user.getRole() == role)
                   .collect(Collectors.toList());
    }
    
    /**
     * Filters users using a custom predicate.
     * 
     * @param predicate The filter predicate
     * @return A list of filtered users
     */
    public List<User> filterUsers(Predicate<User> predicate) {
        return users.values().stream()
                   .filter(predicate)
                   .collect(Collectors.toList());
    }
    
    /**
     * Searches users by name or username.
     * 
     * @param query The search query
     * @return A list of matching users
     */
    public List<User> searchUsers(String query) {
        if (StringUtils.isBlank(query)) {
            return new ArrayList<>();
        }
        
        String lowercaseQuery = query.toLowerCase();
        return users.values().stream()
                   .filter(user -> 
                       user.getName().toLowerCase().contains(lowercaseQuery) ||
                       user.getUsername().toLowerCase().contains(lowercaseQuery) ||
                       (user.getEmail() != null && user.getEmail().toLowerCase().contains(lowercaseQuery)))
                   .collect(Collectors.toList());
    }
    
    /**
     * Gets users older than specified age.
     * 
     * @param age The age threshold
     * @return A list of users older than the specified age
     */
    public List<User> getUsersOlderThan(int age) {
        return filterUsers(user -> user.getAge() > age);
    }
    
    /**
     * Gets users with email addresses.
     * 
     * @return A list of users with email addresses
     */
    public List<User> getUsersWithEmail() {
        return filterUsers(User::hasEmail);
    }
    
    /**
     * Gets users with specific permission.
     * 
     * @param permission The permission to check
     * @return A list of users with the specified permission
     */
    public List<User> getUsersWithPermission(String permission) {
        return filterUsers(user -> user.hasPermission(permission));
    }
    
    /**
     * Gets the total number of users.
     * 
     * @return The user count
     */
    public int getUserCount() {
        return users.size();
    }
    
    /**
     * Gets user statistics.
     * 
     * @return A map of user statistics
     */
    public Map<String, Integer> getUserStats() {
        Map<String, Integer> stats = new HashMap<>();
        
        stats.put("total", users.size());
        stats.put("active", getActiveUsers().size());
        stats.put("admin", getUsersByRole(UserRole.ADMIN).size());
        stats.put("user", getUsersByRole(UserRole.USER).size());
        stats.put("guest", getUsersByRole(UserRole.GUEST).size());
        stats.put("with_email", getUsersWithEmail().size());
        
        return stats;
    }
    
    /**
     * Exports users to specified format.
     * 
     * @param format The export format ("json" or "csv")
     * @return The exported data as string
     * @throws IllegalArgumentException if format is unsupported
     */
    public String exportUsers(String format) {
        switch (format.toLowerCase()) {
            case "json":
                return exportToJson();
            case "csv":
                return exportToCsv();
            default:
                throw new IllegalArgumentException("Unsupported export format: " + format);
        }
    }
    
    /**
     * Exports users to JSON format.
     * 
     * @return JSON string representation of users
     */
    private String exportToJson() {
        try {
            return objectMapper.writerWithDefaultPrettyPrinter()
                              .writeValueAsString(users.values());
        } catch (JsonProcessingException e) {
            logger.error("Error exporting users to JSON", e);
            return "[]";
        }
    }
    
    /**
     * Exports users to CSV format.
     * 
     * @return CSV string representation of users
     */
    private String exportToCsv() {
        try (StringWriter writer = new StringWriter();
             CSVPrinter printer = new CSVPrinter(writer, CSVFormat.DEFAULT.withHeader(
                 "Username", "Name", "Age", "Email", "Role", "Status", "Last Login"))) {
            
            for (User user : users.values()) {
                printer.printRecord(
                    user.getUsername(),
                    user.getName(),
                    user.getAge(),
                    user.getEmail(),
                    user.getRole().getCode(),
                    user.getStatus().getCode(),
                    user.getLastLogin()
                );
            }
            
            return writer.toString();
        } catch (IOException e) {
            logger.error("Error exporting users to CSV", e);
            return "Username,Name,Age,Email,Role,Status,Last Login\n";
        }
    }
    
    /**
     * Checks if a username exists in the system.
     * 
     * @param username The username to check
     * @return true if username exists
     */
    public boolean userExists(String username) {
        return users.containsKey(username);
    }
    
    /**
     * Clears all users from the system.
     */
    public void clearAllUsers() {
        users.clear();
        saveUsersToFile();
        logger.info("All users cleared from system");
    }
    
    /**
     * Loads users from file storage.
     */
    private void loadUsersFromFile() {
        if (StringUtils.isBlank(storagePath)) {
            return;
        }
        
        try {
            Path path = Paths.get(storagePath);
            if (!Files.exists(path)) {
                logger.debug("User storage file does not exist: {}", storagePath);
                return;
            }
            
            String content = Files.readString(path);
            List<User> userList = Arrays.asList(objectMapper.readValue(content, User[].class));
            
            users.clear();
            for (User user : userList) {
                users.put(user.getUsername(), user);
            }
            
            logger.info("Loaded {} users from file: {}", users.size(), storagePath);
        } catch (IOException e) {
            logger.error("Error loading users from file: {}", storagePath, e);
        }
    }
    
    /**
     * Saves users to file storage.
     */
    private void saveUsersToFile() {
        if (StringUtils.isBlank(storagePath)) {
            return;
        }
        
        try {
            Path path = Paths.get(storagePath);
            Files.createDirectories(path.getParent());
            
            String content = objectMapper.writerWithDefaultPrettyPrinter()
                                        .writeValueAsString(users.values());
            Files.writeString(path, content);
            
            logger.debug("Saved {} users to file: {}", users.size(), storagePath);
        } catch (IOException e) {
            logger.error("Error saving users to file: {}", storagePath, e);
        }
    }

    // CI marker method to verify auto-reindex on change
    public String ciAddedSymbolMarker() {
        return "ci_symbol_java";
    }
}