package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/example/user-management/internal/models"
	"github.com/example/user-management/internal/services"
	"github.com/example/user-management/internal/utils"
	"github.com/example/user-management/pkg/api"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func main() {
	// Initialize database
	db, err := initDatabase()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	// Initialize services
	userService := services.NewUserService(db)

	// Initialize API handlers
	userHandler := api.NewUserHandler(userService)

	// Setup routes
	router := setupRoutes(userHandler)

	// Create sample data
	createSampleData(userService)

	// Start server
	log.Println("Starting server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func initDatabase() (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open("users.db"), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	// Auto migrate
	if err := db.AutoMigrate(&models.User{}); err != nil {
		return nil, err
	}

	return db, nil
}

func setupRoutes(userHandler *api.UserHandler) *gin.Engine {
	router := gin.Default()

	// Middleware
	router.Use(corsMiddleware())
	router.Use(loggingMiddleware())

	// Health check
	router.GET("/health", healthCheck)

	// API routes
	v1 := router.Group("/api/v1")
	{
		users := v1.Group("/users")
		{
			users.POST("", userHandler.CreateUser)
			users.GET("", userHandler.GetUsers)
			users.GET("/:id", userHandler.GetUser)
			users.PUT("/:id", userHandler.UpdateUser)
			users.DELETE("/:id", userHandler.DeleteUser)
			users.GET("/search", userHandler.SearchUsers)
			users.GET("/stats", userHandler.GetUserStats)
			users.GET("/export", userHandler.ExportUsers)
		}

		auth := v1.Group("/auth")
		{
			auth.POST("/login", userHandler.Login)
			auth.POST("/logout", userHandler.Logout)
			auth.POST("/change-password", userHandler.ChangePassword)
		}

		admin := v1.Group("/admin")
		{
			admin.POST("/users/:id/reset-password", userHandler.ResetPassword)
			admin.POST("/users/:id/permissions", userHandler.AddPermission)
			admin.DELETE("/users/:id/permissions", userHandler.RemovePermission)
		}
	}

	return router
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now().UTC(),
		"version":   "1.0.0",
	})
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}

		c.Next()
	}
}

func loggingMiddleware() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("%s - [%s] \"%s %s %s %d %s \"%s\" %s\"\n",
			param.ClientIP,
			param.TimeStamp.Format(time.RFC1123),
			param.Method,
			param.Path,
			param.Request.Proto,
			param.StatusCode,
			param.Latency,
			param.Request.UserAgent(),
			param.ErrorMessage,
		)
	})
}

func createSampleData(userService *services.UserService) {
	// Check if admin user already exists
	if _, err := userService.GetUserByUsername("admin"); err == nil {
		return // Admin user already exists
	}

	// Create admin user
	adminReq := &models.UserRequest{
		Username: "admin",
		Email:    "admin@example.com",
		Name:     "System Administrator",
		Age:      30,
		Password: "admin123",
		Role:     models.RoleAdmin,
	}

	admin, err := userService.CreateUser(adminReq)
	if err != nil {
		log.Printf("Failed to create admin user: %v", err)
		return
	}

	// Add admin permissions
	permissions := []string{
		"user_management",
		"system_admin",
		"user_read",
		"user_write",
		"user_delete",
	}

	for _, perm := range permissions {
		if err := userService.AddPermission(admin.ID, perm); err != nil {
			log.Printf("Failed to add permission %s to admin: %v", perm, err)
		}
	}

	// Create sample users
	sampleUsers := []*models.UserRequest{
		{
			Username: "john_doe",
			Email:    "john@example.com",
			Name:     "John Doe",
			Age:      25,
			Password: "password123",
			Role:     models.RoleUser,
		},
		{
			Username: "jane_smith",
			Email:    "jane@example.com",
			Name:     "Jane Smith",
			Age:      28,
			Password: "password123",
			Role:     models.RoleUser,
		},
		{
			Username: "guest_user",
			Email:    "guest@example.com",
			Name:     "Guest User",
			Age:      22,
			Password: "password123",
			Role:     models.RoleGuest,
		},
	}

	for _, userReq := range sampleUsers {
		if _, err := userService.CreateUser(userReq); err != nil {
			log.Printf("Failed to create user %s: %v", userReq.Username, err)
		}
	}

	log.Println("Sample data created successfully")
}

// Helper functions for demo
func printUserStats(userService *services.UserService) {
	stats, err := userService.GetUserStats()
	if err != nil {
		log.Printf("Failed to get user stats: %v", err)
		return
	}

	log.Printf("User Statistics:")
	log.Printf("  Total: %d", stats.Total)
	log.Printf("  Active: %d", stats.Active)
	log.Printf("  Admin: %d", stats.Admin)
	log.Printf("  User: %d", stats.User)
	log.Printf("  Guest: %d", stats.Guest)
	log.Printf("  With Email: %d", stats.WithEmail)
}

func demonstrateUserOperations(userService *services.UserService) {
	log.Println("\n=== User Management Demo ===")

	// Get all users
	users, total, err := userService.GetAllUsers(1, 10)
	if err != nil {
		log.Printf("Failed to get users: %v", err)
		return
	}

	log.Printf("Found %d users (total: %d):", len(users), total)
	for _, user := range users {
		log.Printf("  - %s (%s) - %s [%s]", 
			user.Username, user.Name, user.Role, user.Status)
	}

	// Test authentication
	log.Println("\n=== Authentication Test ===")
	user, err := userService.AuthenticateUser("admin", "admin123")
	if err != nil {
		log.Printf("Authentication failed: %v", err)
	} else {
		log.Printf("Authentication successful for: %s", user.Username)
		log.Printf("Last login: %v", user.LastLogin)
	}

	// Test search
	log.Println("\n=== Search Test ===")
	searchResults, _, err := userService.SearchUsers("john", 1, 10)
	if err != nil {
		log.Printf("Search failed: %v", err)
	} else {
		log.Printf("Search results for 'john': %d users", len(searchResults))
		for _, user := range searchResults {
			log.Printf("  - %s (%s)", user.Username, user.Name)
		}
	}

	// Print stats
	log.Println("\n=== Statistics ===")
	printUserStats(userService)
}

// Run demo if not in server mode
func runDemo() {
	log.Println("Running User Management Demo...")

	// Initialize database
	db, err := initDatabase()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	// Initialize services
	userService := services.NewUserService(db)

	// Create sample data
	createSampleData(userService)

	// Demonstrate operations
	demonstrateUserOperations(userService)

	log.Println("\nDemo completed!")
}