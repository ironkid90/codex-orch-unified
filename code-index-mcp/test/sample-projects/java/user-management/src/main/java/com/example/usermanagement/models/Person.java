package com.example.usermanagement.models;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.apache.commons.lang3.StringUtils;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Represents a person with basic information.
 * This class serves as the base class for more specific person types.
 */
public class Person {
    
    @JsonProperty("name")
    private String name;
    
    @JsonProperty("age")
    private int age;
    
    @JsonProperty("email")
    private String email;
    
    @JsonProperty("created_at")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime createdAt;
    
    @JsonProperty("metadata")
    private Map<String, Object> metadata;
    
    /**
     * Default constructor for Jackson deserialization.
     */
    public Person() {
        this.createdAt = LocalDateTime.now();
        this.metadata = new HashMap<>();
    }
    
    /**
     * Constructor with name and age.
     * 
     * @param name The person's name
     * @param age The person's age
     * @throws IllegalArgumentException if validation fails
     */
    public Person(String name, int age) {
        this();
        setName(name);
        setAge(age);
    }
    
    /**
     * Constructor with name, age, and email.
     * 
     * @param name The person's name
     * @param age The person's age
     * @param email The person's email address
     * @throws IllegalArgumentException if validation fails
     */
    public Person(String name, int age, String email) {
        this(name, age);
        setEmail(email);
    }
    
    // Getters and Setters
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        if (StringUtils.isBlank(name)) {
            throw new IllegalArgumentException("Name cannot be null or empty");
        }
        if (name.length() > 100) {
            throw new IllegalArgumentException("Name cannot exceed 100 characters");
        }
        this.name = name.trim();
    }
    
    public int getAge() {
        return age;
    }
    
    public void setAge(int age) {
        if (age < 0) {
            throw new IllegalArgumentException("Age cannot be negative");
        }
        if (age > 150) {
            throw new IllegalArgumentException("Age cannot exceed 150");
        }
        this.age = age;
    }
    
    public String getEmail() {
        return email;
    }
    
    public void setEmail(String email) {
        if (StringUtils.isNotBlank(email) && !isValidEmail(email)) {
            throw new IllegalArgumentException("Invalid email format");
        }
        this.email = StringUtils.isBlank(email) ? null : email.trim();
    }
    
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
    
    public Map<String, Object> getMetadata() {
        return new HashMap<>(metadata);
    }
    
    public void setMetadata(Map<String, Object> metadata) {
        this.metadata = metadata == null ? new HashMap<>() : new HashMap<>(metadata);
    }
    
    // Business methods
    
    /**
     * Returns a greeting message for the person.
     * 
     * @return A personalized greeting
     */
    public String greet() {
        return String.format("Hello, I'm %s and I'm %d years old.", name, age);
    }
    
    /**
     * Checks if the person has an email address.
     * 
     * @return true if email is present and not empty
     */
    public boolean hasEmail() {
        return StringUtils.isNotBlank(email);
    }
    
    /**
     * Updates the person's email address.
     * 
     * @param newEmail The new email address
     * @throws IllegalArgumentException if email format is invalid
     */
    public void updateEmail(String newEmail) {
        setEmail(newEmail);
    }
    
    /**
     * Adds metadata to the person.
     * 
     * @param key The metadata key
     * @param value The metadata value
     */
    public void addMetadata(String key, Object value) {
        if (StringUtils.isNotBlank(key)) {
            metadata.put(key, value);
        }
    }
    
    /**
     * Gets metadata value by key.
     * 
     * @param key The metadata key
     * @return The metadata value or null if not found
     */
    public Object getMetadata(String key) {
        return metadata.get(key);
    }
    
    /**
     * Gets metadata value by key with default value.
     * 
     * @param key The metadata key
     * @param defaultValue The default value if key is not found
     * @return The metadata value or default value
     */
    public Object getMetadata(String key, Object defaultValue) {
        return metadata.getOrDefault(key, defaultValue);
    }
    
    /**
     * Removes metadata by key.
     * 
     * @param key The metadata key to remove
     * @return The removed value or null if not found
     */
    public Object removeMetadata(String key) {
        return metadata.remove(key);
    }
    
    /**
     * Clears all metadata.
     */
    public void clearMetadata() {
        metadata.clear();
    }
    
    /**
     * Validates email format using a simple regex.
     * 
     * @param email The email to validate
     * @return true if email format is valid
     */
    private boolean isValidEmail(String email) {
        String emailPattern = "^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$";
        return email.matches(emailPattern);
    }
    
    /**
     * Creates a Person instance from a map of data.
     * 
     * @param data The data map
     * @return A new Person instance
     */
    public static Person fromMap(Map<String, Object> data) {
        Person person = new Person();
        
        if (data.containsKey("name")) {
            person.setName((String) data.get("name"));
        }
        
        if (data.containsKey("age")) {
            person.setAge((Integer) data.get("age"));
        }
        
        if (data.containsKey("email")) {
            person.setEmail((String) data.get("email"));
        }
        
        if (data.containsKey("metadata")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> metadata = (Map<String, Object>) data.get("metadata");
            person.setMetadata(metadata);
        }
        
        return person;
    }
    
    /**
     * Converts the person to a map representation.
     * 
     * @return A map containing person data
     */
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>();
        map.put("name", name);
        map.put("age", age);
        map.put("email", email);
        map.put("created_at", createdAt);
        map.put("metadata", new HashMap<>(metadata));
        return map;
    }
    
    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        
        Person person = (Person) obj;
        return age == person.age &&
               Objects.equals(name, person.name) &&
               Objects.equals(email, person.email) &&
               Objects.equals(createdAt, person.createdAt) &&
               Objects.equals(metadata, person.metadata);
    }
    
    @Override
    public int hashCode() {
        return Objects.hash(name, age, email, createdAt, metadata);
    }
    
    @Override
    public String toString() {
        return String.format("Person{name='%s', age=%d, email='%s', createdAt=%s}", 
                           name, age, email, createdAt);
    }
}