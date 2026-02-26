# User Management System (Java)

A comprehensive user management system built in Java for testing Code Index MCP's analysis capabilities.

## Features

- **User Management**: Create, update, delete, and search users
- **Authentication**: BCrypt password hashing and verification
- **Authorization**: Role-based access control (Admin, User, Guest)
- **Data Validation**: Input validation and sanitization
- **Export/Import**: JSON and CSV export capabilities
- **Persistence**: File-based storage with JSON serialization
- **Logging**: SLF4J logging with Logback

## Project Structure

```
src/main/java/com/example/usermanagement/
├── models/
│   ├── Person.java            # Base person model
│   ├── User.java              # User model with auth features
│   ├── UserRole.java          # User role enumeration
│   └── UserStatus.java        # User status enumeration
├── services/
│   └── UserManager.java       # User management service
├── utils/
│   ├── ValidationUtils.java   # Validation utilities
│   ├── UserNotFoundException.java    # Custom exception
│   └── DuplicateUserException.java   # Custom exception
└── Main.java                  # Main demo application
```

## Technologies Used

- **Java 11**: Modern Java features and APIs
- **Jackson**: JSON processing and serialization
- **BCrypt**: Secure password hashing
- **Apache Commons**: Utility libraries (Lang3, CSV)
- **SLF4J + Logback**: Logging framework
- **Maven**: Build and dependency management
- **JUnit 5**: Testing framework

## Build and Run

### Prerequisites

- Java 11 or higher
- Maven 3.6+

### Build

```bash
mvn clean compile
```

### Run

```bash
mvn exec:java -Dexec.mainClass="com.example.usermanagement.Main"
```

### Test

```bash
mvn test
```

### Package

```bash
mvn package
```

## Usage

### Creating Users

```java
UserManager userManager = new UserManager();

// Create a basic user
User user = userManager.createUser("John Doe", 30, "john_doe", "john@example.com");
user.setPassword("SecurePass123!");

// Create an admin user
User admin = userManager.createUser("Jane Smith", 35, "jane_admin", 
                                  "jane@example.com", UserRole.ADMIN);
admin.setPassword("AdminPass123!");
admin.addPermission("user_management");
```

### User Authentication

```java
// Verify password
boolean isValid = user.verifyPassword("SecurePass123!");

// Login
if (user.login()) {
    System.out.println("Login successful!");
    System.out.println("Last login: " + user.getLastLogin());
}
```

### User Management

```java
// Search users
List<User> results = userManager.searchUsers("john");

// Filter users
List<User> activeUsers = userManager.getActiveUsers();
List<User> adminUsers = userManager.getUsersByRole(UserRole.ADMIN);
List<User> olderUsers = userManager.getUsersOlderThan(25);

// Update user
Map<String, Object> updates = Map.of("age", 31, "email", "newemail@example.com");
userManager.updateUser("john_doe", updates);

// Export users
String jsonData = userManager.exportUsers("json");
String csvData = userManager.exportUsers("csv");
```

## Testing Features

This project tests the following Java language features:

### Core Language Features
- **Classes and Inheritance**: Person and User class hierarchy
- **Enums**: UserRole and UserStatus with methods
- **Interfaces**: Custom exceptions and validation
- **Generics**: Collections with type safety
- **Annotations**: Jackson JSON annotations
- **Exception Handling**: Custom exceptions and try-catch blocks

### Modern Java Features
- **Streams API**: Filtering, mapping, and collecting
- **Lambda Expressions**: Functional programming
- **Method References**: Stream operations
- **Optional**: Null-safe operations
- **Time API**: LocalDateTime usage

### Advanced Features
- **Concurrent Collections**: ConcurrentHashMap
- **Reflection**: Jackson serialization
- **File I/O**: NIO.2 Path and Files
- **Logging**: SLF4J with parameterized messages
- **Validation**: Input validation and sanitization

### Framework Integration
- **Maven**: Build lifecycle and dependency management
- **Jackson**: JSON serialization/deserialization
- **BCrypt**: Password hashing
- **Apache Commons**: Utility libraries
- **SLF4J**: Structured logging

### Design Patterns
- **Builder Pattern**: Object construction
- **Factory Pattern**: User creation
- **Repository Pattern**: Data access
- **Service Layer**: Business logic separation

## Dependencies

### Core Dependencies
- **Jackson Databind**: JSON processing
- **Jackson JSR310**: Java 8 time support
- **BCrypt**: Password hashing
- **Apache Commons Lang3**: Utilities
- **Apache Commons CSV**: CSV processing

### Logging
- **SLF4J API**: Logging facade
- **Logback Classic**: Logging implementation

### Testing
- **JUnit 5**: Testing framework
- **Mockito**: Mocking framework

## License

MIT License - This is a sample project for testing purposes.