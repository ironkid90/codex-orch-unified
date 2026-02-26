package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/user-management/internal/models"
	"github.com/example/user-management/internal/utils"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserService handles user-related business logic
type UserService struct {
	db *gorm.DB
}

// NewUserService creates a new user service
func NewUserService(db *gorm.DB) *UserService {
	return &UserService{db: db}
}

// CreateUser creates a new user
func (s *UserService) CreateUser(req *models.UserRequest) (*models.User, error) {
	// Check if username already exists
	var existingUser models.User
	if err := s.db.Where("username = ?", req.Username).First(&existingUser).Error; err == nil {
		return nil, errors.New("username already exists")
	}
	
	// Check if email already exists (if provided)
	if req.Email != "" {
		if err := s.db.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
			return nil, errors.New("email already exists")
		}
	}
	
	// Create new user
	user := &models.User{
		Role:   models.RoleUser,
		Status: models.StatusActive,
	}
	
	if err := user.FromRequest(req); err != nil {
		return nil, fmt.Errorf("failed to create user from request: %w", err)
	}
	
	if err := user.Validate(); err != nil {
		return nil, fmt.Errorf("user validation failed: %w", err)
	}
	
	if err := s.db.Create(user).Error; err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	
	return user, nil
}

// GetUserByID retrieves a user by ID
func (s *UserService) GetUserByID(id uuid.UUID) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return &user, nil
}

// GetUserByUsername retrieves a user by username
func (s *UserService) GetUserByUsername(username string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return &user, nil
}

// GetUserByEmail retrieves a user by email
func (s *UserService) GetUserByEmail(email string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return &user, nil
}

// UpdateUser updates an existing user
func (s *UserService) UpdateUser(id uuid.UUID, updates map[string]interface{}) (*models.User, error) {
	user, err := s.GetUserByID(id)
	if err != nil {
		return nil, err
	}
	
	// Apply updates
	for key, value := range updates {
		switch key {
		case "name":
			if name, ok := value.(string); ok {
				user.Name = name
			}
		case "age":
			if age, ok := value.(int); ok {
				user.Age = age
			}
		case "email":
			if email, ok := value.(string); ok {
				user.Email = email
			}
		case "role":
			if role, ok := value.(models.UserRole); ok {
				user.Role = role
			}
		case "status":
			if status, ok := value.(models.UserStatus); ok {
				user.Status = status
			}
		case "metadata":
			if metadata, ok := value.(map[string]interface{}); ok {
				user.Metadata = metadata
			}
		}
	}
	
	if err := user.Validate(); err != nil {
		return nil, fmt.Errorf("user validation failed: %w", err)
	}
	
	if err := s.db.Save(user).Error; err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}
	
	return user, nil
}

// DeleteUser soft deletes a user
func (s *UserService) DeleteUser(id uuid.UUID) error {
	user, err := s.GetUserByID(id)
	if err != nil {
		return err
	}
	
	user.Delete()
	
	if err := s.db.Save(user).Error; err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	
	return nil
}

// HardDeleteUser permanently deletes a user
func (s *UserService) HardDeleteUser(id uuid.UUID) error {
	if err := s.db.Unscoped().Delete(&models.User{}, id).Error; err != nil {
		return fmt.Errorf("failed to hard delete user: %w", err)
	}
	return nil
}

// GetAllUsers retrieves all users with pagination
func (s *UserService) GetAllUsers(page, pageSize int) ([]*models.User, int64, error) {
	var users []*models.User
	var total int64
	
	// Count total users
	if err := s.db.Model(&models.User{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count users: %w", err)
	}
	
	// Get users with pagination
	offset := (page - 1) * pageSize
	if err := s.db.Limit(pageSize).Offset(offset).Find(&users).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to get users: %w", err)
	}
	
	return users, total, nil
}

// GetActiveUsers retrieves all active users
func (s *UserService) GetActiveUsers() ([]*models.User, error) {
	var users []*models.User
	if err := s.db.Where("status = ?", models.StatusActive).Find(&users).Error; err != nil {
		return nil, fmt.Errorf("failed to get active users: %w", err)
	}
	return users, nil
}

// GetUsersByRole retrieves users by role
func (s *UserService) GetUsersByRole(role models.UserRole) ([]*models.User, error) {
	var users []*models.User
	if err := s.db.Where("role = ?", role).Find(&users).Error; err != nil {
		return nil, fmt.Errorf("failed to get users by role: %w", err)
	}
	return users, nil
}

// SearchUsers searches for users by name or username
func (s *UserService) SearchUsers(query string, page, pageSize int) ([]*models.User, int64, error) {
	var users []*models.User
	var total int64
	
	searchQuery := "%" + strings.ToLower(query) + "%"
	
	// Count total matching users
	if err := s.db.Model(&models.User{}).Where(
		"LOWER(name) LIKE ? OR LOWER(username) LIKE ? OR LOWER(email) LIKE ?",
		searchQuery, searchQuery, searchQuery,
	).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count search results: %w", err)
	}
	
	// Get matching users with pagination
	offset := (page - 1) * pageSize
	if err := s.db.Where(
		"LOWER(name) LIKE ? OR LOWER(username) LIKE ? OR LOWER(email) LIKE ?",
		searchQuery, searchQuery, searchQuery,
	).Limit(pageSize).Offset(offset).Find(&users).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to search users: %w", err)
	}
	
	return users, total, nil
}

// GetUserStats returns user statistics
func (s *UserService) GetUserStats() (*utils.UserStats, error) {
	var stats utils.UserStats
	
	// Total users
	if err := s.db.Model(&models.User{}).Count(&stats.Total).Error; err != nil {
		return nil, fmt.Errorf("failed to count total users: %w", err)
	}
	
	// Active users
	if err := s.db.Model(&models.User{}).Where("status = ?", models.StatusActive).Count(&stats.Active).Error; err != nil {
		return nil, fmt.Errorf("failed to count active users: %w", err)
	}
	
	// Admin users
	if err := s.db.Model(&models.User{}).Where("role = ?", models.RoleAdmin).Count(&stats.Admin).Error; err != nil {
		return nil, fmt.Errorf("failed to count admin users: %w", err)
	}
	
	// Regular users
	if err := s.db.Model(&models.User{}).Where("role = ?", models.RoleUser).Count(&stats.User).Error; err != nil {
		return nil, fmt.Errorf("failed to count regular users: %w", err)
	}
	
	// Guest users
	if err := s.db.Model(&models.User{}).Where("role = ?", models.RoleGuest).Count(&stats.Guest).Error; err != nil {
		return nil, fmt.Errorf("failed to count guest users: %w", err)
	}
	
	// Users with email
	if err := s.db.Model(&models.User{}).Where("email != ''").Count(&stats.WithEmail).Error; err != nil {
		return nil, fmt.Errorf("failed to count users with email: %w", err)
	}
	
	return &stats, nil
}

// AuthenticateUser authenticates a user with username and password
func (s *UserService) AuthenticateUser(username, password string) (*models.User, error) {
	user, err := s.GetUserByUsername(username)
	if err != nil {
		return nil, errors.New("invalid username or password")
	}
	
	if !user.IsActive() {
		return nil, errors.New("user account is not active")
	}
	
	if user.IsLocked() {
		return nil, errors.New("user account is locked")
	}
	
	if !user.VerifyPassword(password) {
		user.FailedLoginAttempt()
		if err := s.db.Save(user).Error; err != nil {
			return nil, fmt.Errorf("failed to update failed login attempt: %w", err)
		}
		return nil, errors.New("invalid username or password")
	}
	
	// Successful login
	if err := user.Login(); err != nil {
		return nil, fmt.Errorf("login failed: %w", err)
	}
	
	if err := s.db.Save(user).Error; err != nil {
		return nil, fmt.Errorf("failed to update login info: %w", err)
	}
	
	return user, nil
}

// ChangePassword changes a user's password
func (s *UserService) ChangePassword(id uuid.UUID, currentPassword, newPassword string) error {
	user, err := s.GetUserByID(id)
	if err != nil {
		return err
	}
	
	if !user.VerifyPassword(currentPassword) {
		return errors.New("current password is incorrect")
	}
	
	if err := user.SetPassword(newPassword); err != nil {
		return fmt.Errorf("failed to set new password: %w", err)
	}
	
	if err := s.db.Save(user).Error; err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}
	
	return nil
}

// ResetPassword resets a user's password (admin function)
func (s *UserService) ResetPassword(id uuid.UUID, newPassword string) error {
	user, err := s.GetUserByID(id)
	if err != nil {
		return err
	}
	
	if err := user.SetPassword(newPassword); err != nil {
		return fmt.Errorf("failed to set new password: %w", err)
	}
	
	user.ResetLoginAttempts()
	
	if err := s.db.Save(user).Error; err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}
	
	return nil
}

// AddPermission adds a permission to a user
func (s *UserService) AddPermission(id uuid.UUID, permission string) error {
	user, err := s.GetUserByID(id)
	if err != nil {
		return err
	}
	
	user.AddPermission(permission)
	
	if err := s.db.Save(user).Error; err != nil {
		return fmt.Errorf("failed to add permission: %w", err)
	}
	
	return nil
}

// RemovePermission removes a permission from a user
func (s *UserService) RemovePermission(id uuid.UUID, permission string) error {
	user, err := s.GetUserByID(id)
	if err != nil {
		return err
	}
	
	user.RemovePermission(permission)
	
	if err := s.db.Save(user).Error; err != nil {
		return fmt.Errorf("failed to remove permission: %w", err)
	}
	
	return nil
}

// ExportUsers exports users to JSON
func (s *UserService) ExportUsers() ([]byte, error) {
	users, _, err := s.GetAllUsers(1, 1000) // Get all users (limit to 1000 for safety)
	if err != nil {
		return nil, fmt.Errorf("failed to get users for export: %w", err)
	}
	
	var responses []*models.UserResponse
	for _, user := range users {
		responses = append(responses, user.ToResponse())
	}
	
	data, err := json.MarshalIndent(responses, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal users: %w", err)
	}
	
	return data, nil
}

// GetUserActivity returns user activity information
func (s *UserService) GetUserActivity(id uuid.UUID) (*utils.UserActivity, error) {
	user, err := s.GetUserByID(id)
	if err != nil {
		return nil, err
	}
	
	activity := &utils.UserActivity{
		UserID:        user.ID,
		Username:      user.Username,
		LastLogin:     user.LastLogin,
		LoginAttempts: user.LoginAttempts,
		IsActive:      user.IsActive(),
		IsLocked:      user.IsLocked(),
		CreatedAt:     user.CreatedAt,
		UpdatedAt:     user.UpdatedAt,
	}
	
	return activity, nil
}