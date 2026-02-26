package api

import (
	"net/http"
	"strconv"

	"github.com/example/user-management/internal/models"
	"github.com/example/user-management/internal/services"
	"github.com/example/user-management/internal/utils"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// UserHandler handles user-related HTTP requests
type UserHandler struct {
	userService *services.UserService
}

// NewUserHandler creates a new user handler
func NewUserHandler(userService *services.UserService) *UserHandler {
	return &UserHandler{
		userService: userService,
	}
}

// CreateUser handles user creation
func (h *UserHandler) CreateUser(c *gin.Context) {
	var req models.UserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid request", err))
		return
	}

	user, err := h.userService.CreateUser(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Failed to create user", err))
		return
	}

	c.JSON(http.StatusCreated, utils.NewSuccessResponse("User created successfully", user.ToResponse()))
}

// GetUser handles getting a single user
func (h *UserHandler) GetUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid user ID", err))
		return
	}

	user, err := h.userService.GetUserByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, utils.NewErrorResponse("User not found", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("User retrieved successfully", user.ToResponse()))
}

// GetUsers handles getting users with pagination
func (h *UserHandler) GetUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	users, total, err := h.userService.GetAllUsers(page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, utils.NewErrorResponse("Failed to get users", err))
		return
	}

	var responses []*models.UserResponse
	for _, user := range users {
		responses = append(responses, user.ToResponse())
	}

	paginatedResponse := utils.NewPaginatedResponse(responses, page, pageSize, total)
	c.JSON(http.StatusOK, utils.NewSuccessResponse("Users retrieved successfully", paginatedResponse))
}

// UpdateUser handles user updates
func (h *UserHandler) UpdateUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid user ID", err))
		return
	}

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid request", err))
		return
	}

	user, err := h.userService.UpdateUser(id, updates)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Failed to update user", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("User updated successfully", user.ToResponse()))
}

// DeleteUser handles user deletion
func (h *UserHandler) DeleteUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid user ID", err))
		return
	}

	if err := h.userService.DeleteUser(id); err != nil {
		c.JSON(http.StatusInternalServerError, utils.NewErrorResponse("Failed to delete user", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("User deleted successfully", nil))
}

// SearchUsers handles user search
func (h *UserHandler) SearchUsers(c *gin.Context) {
	query := c.Query("q")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	users, total, err := h.userService.SearchUsers(query, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, utils.NewErrorResponse("Failed to search users", err))
		return
	}

	var responses []*models.UserResponse
	for _, user := range users {
		responses = append(responses, user.ToResponse())
	}

	paginatedResponse := utils.NewPaginatedResponse(responses, page, pageSize, total)
	c.JSON(http.StatusOK, utils.NewSuccessResponse("Search completed successfully", paginatedResponse))
}

// GetUserStats handles getting user statistics
func (h *UserHandler) GetUserStats(c *gin.Context) {
	stats, err := h.userService.GetUserStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, utils.NewErrorResponse("Failed to get user statistics", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("Statistics retrieved successfully", stats))
}

// ExportUsers handles user export
func (h *UserHandler) ExportUsers(c *gin.Context) {
	data, err := h.userService.ExportUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, utils.NewErrorResponse("Failed to export users", err))
		return
	}

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=users.json")
	c.Data(http.StatusOK, "application/json", data)
}

// Login handles user authentication
func (h *UserHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid request", err))
		return
	}

	user, err := h.userService.AuthenticateUser(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, utils.NewErrorResponse("Authentication failed", err))
		return
	}

	// In a real application, you would generate a JWT token here
	response := map[string]interface{}{
		"user":    user.ToResponse(),
		"token":   "dummy-jwt-token", // This would be a real JWT token
		"expires": "2024-12-31T23:59:59Z",
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("Login successful", response))
}

// Logout handles user logout
func (h *UserHandler) Logout(c *gin.Context) {
	// In a real application, you would invalidate the JWT token here
	c.JSON(http.StatusOK, utils.NewSuccessResponse("Logout successful", nil))
}

// ChangePassword handles password change
func (h *UserHandler) ChangePassword(c *gin.Context) {
	var req struct {
		UserID          uuid.UUID `json:"user_id" binding:"required"`
		CurrentPassword string    `json:"current_password" binding:"required"`
		NewPassword     string    `json:"new_password" binding:"required,min=8"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid request", err))
		return
	}

	if err := h.userService.ChangePassword(req.UserID, req.CurrentPassword, req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Failed to change password", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("Password changed successfully", nil))
}

// ResetPassword handles password reset (admin only)
func (h *UserHandler) ResetPassword(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid user ID", err))
		return
	}

	var req struct {
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid request", err))
		return
	}

	if err := h.userService.ResetPassword(id, req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Failed to reset password", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("Password reset successfully", nil))
}

// AddPermission handles adding permission to user
func (h *UserHandler) AddPermission(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid user ID", err))
		return
	}

	var req struct {
		Permission string `json:"permission" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid request", err))
		return
	}

	if err := h.userService.AddPermission(id, req.Permission); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Failed to add permission", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("Permission added successfully", nil))
}

// RemovePermission handles removing permission from user
func (h *UserHandler) RemovePermission(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Invalid user ID", err))
		return
	}

	permission := c.Query("permission")
	if permission == "" {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Permission parameter is required", nil))
		return
	}

	if err := h.userService.RemovePermission(id, permission); err != nil {
		c.JSON(http.StatusBadRequest, utils.NewErrorResponse("Failed to remove permission", err))
		return
	}

	c.JSON(http.StatusOK, utils.NewSuccessResponse("Permission removed successfully", nil))
}