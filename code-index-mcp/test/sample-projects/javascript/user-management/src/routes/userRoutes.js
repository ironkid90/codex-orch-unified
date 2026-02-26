const express = require('express');
const { body, param, query } = require('express-validator');
const UserService = require('../services/UserService');
const { asyncHandler, createSuccessResponse, createErrorResponse } = require('../utils/errors');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const logger = require('../utils/logger');

const router = express.Router();
const userService = new UserService();

// User creation validation
const createUserValidation = [
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address'),
  body('age')
    .optional()
    .isInt({ min: 0, max: 150 })
    .withMessage('Age must be between 0 and 150'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long'),
  body('role')
    .optional()
    .isIn(['admin', 'user', 'guest'])
    .withMessage('Role must be admin, user, or guest'),
];

// User update validation
const updateUserValidation = [
  param('id').notEmpty().withMessage('User ID is required'),
  body('username')
    .optional()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('name')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address'),
  body('age')
    .optional()
    .isInt({ min: 0, max: 150 })
    .withMessage('Age must be between 0 and 150'),
  body('role')
    .optional()
    .isIn(['admin', 'user', 'guest'])
    .withMessage('Role must be admin, user, or guest'),
];

// Password change validation
const passwordChangeValidation = [
  param('id').notEmpty().withMessage('User ID is required'),
  body('currentPassword')
    .isLength({ min: 1 })
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long'),
];

// Authentication validation
const authValidation = [
  body('username')
    .isLength({ min: 3 })
    .withMessage('Username must be at least 3 characters'),
  body('password')
    .isLength({ min: 1 })
    .withMessage('Password is required'),
];

// Search validation
const searchValidation = [
  query('q')
    .isLength({ min: 1 })
    .withMessage('Search query is required'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

// @route   POST /api/users
// @desc    Create a new user
// @access  Public
router.post('/', createUserValidation, validate, asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.body);
  logger.info(`User created via API: ${user.username}`);
  res.status(201).json(createSuccessResponse(user, 'User created successfully'));
}));

// @route   POST /api/users/auth
// @desc    Authenticate user
// @access  Public
router.post('/auth', authValidation, validate, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await userService.authenticateUser(username, password);
  logger.info(`User authenticated via API: ${username}`);
  res.json(createSuccessResponse(result, 'Authentication successful'));
}));

// @route   GET /api/users
// @desc    Get all users with pagination
// @access  Private (Admin only)
router.get('/', auth, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const filter = {};
  
  // Add filtering by role if provided
  if (req.query.role) {
    filter.role = req.query.role;
  }
  
  // Add filtering by status if provided
  if (req.query.status) {
    filter.status = req.query.status;
  }
  
  const result = await userService.getAllUsers(page, limit, filter);
  res.json(createSuccessResponse(result, 'Users retrieved successfully'));
}));

// @route   GET /api/users/search
// @desc    Search users
// @access  Private
router.get('/search', auth, searchValidation, validate, asyncHandler(async (req, res) => {
  const { q: query, page = 1, limit = 20 } = req.query;
  const result = await userService.searchUsers(query, parseInt(page), parseInt(limit));
  res.json(createSuccessResponse(result, 'Search completed successfully'));
}));

// @route   GET /api/users/stats
// @desc    Get user statistics
// @access  Private (Admin only)
router.get('/stats', auth, asyncHandler(async (req, res) => {
  const stats = await userService.getUserStats();
  res.json(createSuccessResponse(stats, 'Statistics retrieved successfully'));
}));

// @route   GET /api/users/export
// @desc    Export all users
// @access  Private (Admin only)
router.get('/export', auth, asyncHandler(async (req, res) => {
  const users = await userService.exportUsers();
  res.json(createSuccessResponse(users, 'Users exported successfully'));
}));

// @route   GET /api/users/active
// @desc    Get active users
// @access  Private
router.get('/active', auth, asyncHandler(async (req, res) => {
  const users = await userService.getActiveUsers();
  res.json(createSuccessResponse(users, 'Active users retrieved successfully'));
}));

// @route   GET /api/users/role/:role
// @desc    Get users by role
// @access  Private (Admin only)
router.get('/role/:role', auth, asyncHandler(async (req, res) => {
  const { role } = req.params;
  const users = await userService.getUsersByRole(role);
  res.json(createSuccessResponse(users, `Users with role ${role} retrieved successfully`));
}));

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private
router.get('/:id', auth, asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  res.json(createSuccessResponse(user, 'User retrieved successfully'));
}));

// @route   GET /api/users/:id/activity
// @desc    Get user activity
// @access  Private (Admin or same user)
router.get('/:id/activity', auth, asyncHandler(async (req, res) => {
  const activity = await userService.getUserActivity(req.params.id);
  res.json(createSuccessResponse(activity, 'User activity retrieved successfully'));
}));

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private (Admin or same user)
router.put('/:id', auth, updateUserValidation, validate, asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body);
  logger.info(`User updated via API: ${user.username}`);
  res.json(createSuccessResponse(user, 'User updated successfully'));
}));

// @route   PUT /api/users/:id/password
// @desc    Change user password
// @access  Private (Admin or same user)
router.put('/:id/password', auth, passwordChangeValidation, validate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await userService.changePassword(req.params.id, currentPassword, newPassword);
  logger.info(`Password changed via API for user: ${req.params.id}`);
  res.json(createSuccessResponse(null, 'Password changed successfully'));
}));

// @route   PUT /api/users/:id/reset-password
// @desc    Reset user password (Admin only)
// @access  Private (Admin only)
router.put('/:id/reset-password', auth, asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  await userService.resetPassword(req.params.id, newPassword);
  logger.info(`Password reset via API for user: ${req.params.id}`);
  res.json(createSuccessResponse(null, 'Password reset successfully'));
}));

// @route   PUT /api/users/:id/permissions
// @desc    Add permission to user
// @access  Private (Admin only)
router.put('/:id/permissions', auth, asyncHandler(async (req, res) => {
  const { permission } = req.body;
  await userService.addPermission(req.params.id, permission);
  logger.info(`Permission added via API for user: ${req.params.id}`);
  res.json(createSuccessResponse(null, 'Permission added successfully'));
}));

// @route   DELETE /api/users/:id/permissions
// @desc    Remove permission from user
// @access  Private (Admin only)
router.delete('/:id/permissions', auth, asyncHandler(async (req, res) => {
  const { permission } = req.body;
  await userService.removePermission(req.params.id, permission);
  logger.info(`Permission removed via API for user: ${req.params.id}`);
  res.json(createSuccessResponse(null, 'Permission removed successfully'));
}));

// @route   DELETE /api/users/:id
// @desc    Delete user (soft delete)
// @access  Private (Admin only)
router.delete('/:id', auth, asyncHandler(async (req, res) => {
  await userService.deleteUser(req.params.id);
  logger.info(`User deleted via API: ${req.params.id}`);
  res.json(createSuccessResponse(null, 'User deleted successfully'));
}));

// @route   DELETE /api/users/:id/hard
// @desc    Hard delete user (permanent)
// @access  Private (Admin only)
router.delete('/:id/hard', auth, asyncHandler(async (req, res) => {
  await userService.hardDeleteUser(req.params.id);
  logger.info(`User permanently deleted via API: ${req.params.id}`);
  res.json(createSuccessResponse(null, 'User permanently deleted'));
}));

module.exports = router;