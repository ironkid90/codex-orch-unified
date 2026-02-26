package models

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// UserRole represents the role of a user
type UserRole string

const (
	RoleAdmin UserRole = "admin"
	RoleUser  UserRole = "user"
	RoleGuest UserRole = "guest"
)

// UserStatus represents the status of a user
type UserStatus string

const (
	StatusActive    UserStatus = "active"
	StatusInactive  UserStatus = "inactive"
	StatusSuspended UserStatus = "suspended"
	StatusDeleted   UserStatus = "deleted"
)

// User represents a user in the system
type User struct {
	ID           uuid.UUID  `json:"id" gorm:"type:uuid;primary_key"`
	Username     string     `json:"username" gorm:"uniqueIndex;not null"`
	Email        string     `json:"email" gorm:"uniqueIndex"`
	Name         string     `json:"name" gorm:"not null"`
	Age          int        `json:"age"`
	PasswordHash string     `json:"-" gorm:"not null"`
	Role         UserRole   `json:"role" gorm:"default:user"`
	Status       UserStatus `json:"status" gorm:"default:active"`
	LastLogin    *time.Time `json:"last_login"`
	LoginAttempts int       `json:"login_attempts" gorm:"default:0"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
	
	// Permissions is a JSON field containing user permissions
	Permissions []string `json:"permissions" gorm:"type:json"`
	
	// Metadata for additional user information
	Metadata map[string]interface{} `json:"metadata" gorm:"type:json"`
}

// UserRequest represents a request to create or update a user
type UserRequest struct {
	Username string                 `json:"username" binding:"required,min=3,max=20"`
	Email    string                 `json:"email" binding:"omitempty,email"`
	Name     string                 `json:"name" binding:"required,min=1,max=100"`
	Age      int                    `json:"age" binding:"min=0,max=150"`
	Password string                 `json:"password" binding:"required,min=8"`
	Role     UserRole               `json:"role" binding:"omitempty,oneof=admin user guest"`
	Metadata map[string]interface{} `json:"metadata"`
}

// UserResponse represents a user response (without sensitive data)
type UserResponse struct {
	ID          uuid.UUID              `json:"id"`
	Username    string                 `json:"username"`
	Email       string                 `json:"email"`
	Name        string                 `json:"name"`
	Age         int                    `json:"age"`
	Role        UserRole               `json:"role"`
	Status      UserStatus             `json:"status"`
	LastLogin   *time.Time             `json:"last_login"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	Permissions []string               `json:"permissions"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// BeforeCreate is a GORM hook that runs before creating a user
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	
	if u.Permissions == nil {
		u.Permissions = []string{}
	}
	
	if u.Metadata == nil {
		u.Metadata = make(map[string]interface{})
	}
	
	return nil
}

// SetPassword hashes and sets the user's password
func (u *User) SetPassword(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters long")
	}
	
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	
	u.PasswordHash = string(hash)
	return nil
}

// VerifyPassword checks if the provided password matches the user's password
func (u *User) VerifyPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// HasPermission checks if the user has a specific permission
func (u *User) HasPermission(permission string) bool {
	for _, p := range u.Permissions {
		if p == permission {
			return true
		}
	}
	return false
}

// AddPermission adds a permission to the user
func (u *User) AddPermission(permission string) {
	if !u.HasPermission(permission) {
		u.Permissions = append(u.Permissions, permission)
	}
}

// RemovePermission removes a permission from the user
func (u *User) RemovePermission(permission string) {
	for i, p := range u.Permissions {
		if p == permission {
			u.Permissions = append(u.Permissions[:i], u.Permissions[i+1:]...)
			break
		}
	}
}

// IsActive checks if the user is active
func (u *User) IsActive() bool {
	return u.Status == StatusActive
}

// IsAdmin checks if the user is an admin
func (u *User) IsAdmin() bool {
	return u.Role == RoleAdmin
}

// IsLocked checks if the user is locked due to too many failed login attempts
func (u *User) IsLocked() bool {
	return u.LoginAttempts >= 5 || u.Status == StatusSuspended
}

// Login records a successful login
func (u *User) Login() error {
	if !u.IsActive() {
		return errors.New("user is not active")
	}
	
	if u.IsLocked() {
		return errors.New("user is locked")
	}
	
	now := time.Now()
	u.LastLogin = &now
	u.LoginAttempts = 0
	
	return nil
}

// FailedLoginAttempt records a failed login attempt
func (u *User) FailedLoginAttempt() {
	u.LoginAttempts++
	if u.LoginAttempts >= 5 {
		u.Status = StatusSuspended
	}
}

// ResetLoginAttempts resets the login attempts counter
func (u *User) ResetLoginAttempts() {
	u.LoginAttempts = 0
}

// Activate activates the user account
func (u *User) Activate() {
	u.Status = StatusActive
	u.LoginAttempts = 0
}

// Deactivate deactivates the user account
func (u *User) Deactivate() {
	u.Status = StatusInactive
}

// Suspend suspends the user account
func (u *User) Suspend() {
	u.Status = StatusSuspended
}

// Delete marks the user as deleted
func (u *User) Delete() {
	u.Status = StatusDeleted
}

// ToResponse converts a User to a UserResponse
func (u *User) ToResponse() *UserResponse {
	return &UserResponse{
		ID:          u.ID,
		Username:    u.Username,
		Email:       u.Email,
		Name:        u.Name,
		Age:         u.Age,
		Role:        u.Role,
		Status:      u.Status,
		LastLogin:   u.LastLogin,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
		Permissions: u.Permissions,
		Metadata:    u.Metadata,
	}
}

// FromRequest creates a User from a UserRequest
func (u *User) FromRequest(req *UserRequest) error {
	u.Username = req.Username
	u.Email = req.Email
	u.Name = req.Name
	u.Age = req.Age
	u.Role = req.Role
	u.Metadata = req.Metadata
	
	if req.Password != "" {
		return u.SetPassword(req.Password)
	}
	
	return nil
}

// MarshalJSON customizes JSON marshaling for User
func (u *User) MarshalJSON() ([]byte, error) {
	return json.Marshal(u.ToResponse())
}

// Validate validates the user model
func (u *User) Validate() error {
	if len(u.Username) < 3 || len(u.Username) > 20 {
		return errors.New("username must be between 3 and 20 characters")
	}
	
	if len(u.Name) == 0 || len(u.Name) > 100 {
		return errors.New("name must be between 1 and 100 characters")
	}
	
	if u.Age < 0 || u.Age > 150 {
		return errors.New("age must be between 0 and 150")
	}
	
	if u.Role != RoleAdmin && u.Role != RoleUser && u.Role != RoleGuest {
		return errors.New("invalid role")
	}
	
	if u.Status != StatusActive && u.Status != StatusInactive && 
	   u.Status != StatusSuspended && u.Status != StatusDeleted {
		return errors.New("invalid status")
	}
	
	return nil
}

// TableName returns the table name for GORM
func (u *User) TableName() string {
	return "users"
}

// GetMetadata gets a metadata value by key
func (u *User) GetMetadata(key string) (interface{}, bool) {
	if u.Metadata == nil {
		return nil, false
	}
	value, exists := u.Metadata[key]
	return value, exists
}

// SetMetadata sets a metadata value
func (u *User) SetMetadata(key string, value interface{}) {
	if u.Metadata == nil {
		u.Metadata = make(map[string]interface{})
	}
	u.Metadata[key] = value
}

// RemoveMetadata removes a metadata key
func (u *User) RemoveMetadata(key string) {
	if u.Metadata != nil {
		delete(u.Metadata, key)
	}
}

// String returns a string representation of the user
func (u *User) String() string {
	return u.Username + " (" + u.Name + ")"
}