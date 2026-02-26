package utils

import (
	"time"

	"github.com/google/uuid"
)

// UserStats represents user statistics
type UserStats struct {
	Total     int64 `json:"total"`
	Active    int64 `json:"active"`
	Admin     int64 `json:"admin"`
	User      int64 `json:"user"`
	Guest     int64 `json:"guest"`
	WithEmail int64 `json:"with_email"`
}

// UserActivity represents user activity information
type UserActivity struct {
	UserID        uuid.UUID  `json:"user_id"`
	Username      string     `json:"username"`
	LastLogin     *time.Time `json:"last_login"`
	LoginAttempts int        `json:"login_attempts"`
	IsActive      bool       `json:"is_active"`
	IsLocked      bool       `json:"is_locked"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// PaginatedResponse represents a paginated response
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	Total      int64       `json:"total"`
	TotalPages int         `json:"total_pages"`
}

// NewPaginatedResponse creates a new paginated response
func NewPaginatedResponse(data interface{}, page, pageSize int, total int64) *PaginatedResponse {
	totalPages := int((total + int64(pageSize) - 1) / int64(pageSize))
	return &PaginatedResponse{
		Data:       data,
		Page:       page,
		PageSize:   pageSize,
		Total:      total,
		TotalPages: totalPages,
	}
}

// APIResponse represents a standard API response
type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// NewSuccessResponse creates a new success response
func NewSuccessResponse(message string, data interface{}) *APIResponse {
	return &APIResponse{
		Success: true,
		Message: message,
		Data:    data,
	}
}

// NewErrorResponse creates a new error response
func NewErrorResponse(message string, err error) *APIResponse {
	resp := &APIResponse{
		Success: false,
		Message: message,
	}
	
	if err != nil {
		resp.Error = err.Error()
	}
	
	return resp
}

// ValidationError represents a validation error
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationErrors represents multiple validation errors
type ValidationErrors struct {
	Errors []ValidationError `json:"errors"`
}

// NewValidationErrors creates a new validation errors instance
func NewValidationErrors() *ValidationErrors {
	return &ValidationErrors{
		Errors: make([]ValidationError, 0),
	}
}

// Add adds a validation error
func (ve *ValidationErrors) Add(field, message string) {
	ve.Errors = append(ve.Errors, ValidationError{
		Field:   field,
		Message: message,
	})
}

// HasErrors returns true if there are validation errors
func (ve *ValidationErrors) HasErrors() bool {
	return len(ve.Errors) > 0
}

// Error implements the error interface
func (ve *ValidationErrors) Error() string {
	if len(ve.Errors) == 0 {
		return ""
	}
	
	if len(ve.Errors) == 1 {
		return ve.Errors[0].Message
	}
	
	return "multiple validation errors"
}

// DatabaseConfig represents database configuration
type DatabaseConfig struct {
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"ssl_mode"`
}

// ServerConfig represents server configuration
type ServerConfig struct {
	Port         int    `json:"port"`
	Host         string `json:"host"`
	ReadTimeout  int    `json:"read_timeout"`
	WriteTimeout int    `json:"write_timeout"`
	IdleTimeout  int    `json:"idle_timeout"`
}

// JWTConfig represents JWT configuration
type JWTConfig struct {
	SecretKey        string `json:"secret_key"`
	ExpirationHours  int    `json:"expiration_hours"`
	RefreshHours     int    `json:"refresh_hours"`
	Issuer           string `json:"issuer"`
	SigningAlgorithm string `json:"signing_algorithm"`
}

// Config represents application configuration
type Config struct {
	Database DatabaseConfig `json:"database"`
	Server   ServerConfig   `json:"server"`
	JWT      JWTConfig      `json:"jwt"`
	LogLevel string         `json:"log_level"`
	Debug    bool           `json:"debug"`
}

// SearchParams represents search parameters
type SearchParams struct {
	Query    string `json:"query"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	SortBy   string `json:"sort_by"`
	SortDir  string `json:"sort_dir"`
}

// NewSearchParams creates new search parameters with defaults
func NewSearchParams() *SearchParams {
	return &SearchParams{
		Page:     1,
		PageSize: 20,
		SortBy:   "created_at",
		SortDir:  "desc",
	}
}

// Validate validates search parameters
func (sp *SearchParams) Validate() error {
	if sp.Page < 1 {
		sp.Page = 1
	}
	
	if sp.PageSize < 1 {
		sp.PageSize = 20
	}
	
	if sp.PageSize > 100 {
		sp.PageSize = 100
	}
	
	if sp.SortBy == "" {
		sp.SortBy = "created_at"
	}
	
	if sp.SortDir != "asc" && sp.SortDir != "desc" {
		sp.SortDir = "desc"
	}
	
	return nil
}

// FilterParams represents filter parameters
type FilterParams struct {
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	AgeMin    int       `json:"age_min"`
	AgeMax    int       `json:"age_max"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AuditLog represents an audit log entry
type AuditLog struct {
	ID        uuid.UUID              `json:"id"`
	UserID    uuid.UUID              `json:"user_id"`
	Action    string                 `json:"action"`
	Resource  string                 `json:"resource"`
	Details   map[string]interface{} `json:"details"`
	IPAddress string                 `json:"ip_address"`
	UserAgent string                 `json:"user_agent"`
	CreatedAt time.Time              `json:"created_at"`
}

// Session represents a user session
type Session struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// IsExpired checks if the session is expired
func (s *Session) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

// ExtendSession extends the session expiration
func (s *Session) ExtendSession(duration time.Duration) {
	s.ExpiresAt = time.Now().Add(duration)
	s.UpdatedAt = time.Now()
}