const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// User roles enumeration
const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest',
};

// User status enumeration
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
};

// User schema definition
const userSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: uuidv4,
      unique: true,
      required: true,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [20, 'Username cannot exceed 20 characters'],
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      minlength: [1, 'Name is required'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    age: {
      type: Number,
      min: [0, 'Age cannot be negative'],
      max: [150, 'Age cannot exceed 150'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't include in queries by default
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.ACTIVE,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    permissions: {
      type: [String],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for user response (without sensitive data)
userSchema.virtual('response').get(function() {
  return {
    id: this.id,
    username: this.username,
    email: this.email,
    name: this.name,
    age: this.age,
    role: this.role,
    status: this.status,
    lastLogin: this.lastLogin,
    permissions: this.permissions,
    metadata: this.metadata,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
});

// Virtual for checking if user is active
userSchema.virtual('isActive').get(function() {
  return this.status === USER_STATUS.ACTIVE;
});

// Virtual for checking if user is admin
userSchema.virtual('isAdmin').get(function() {
  return this.role === USER_ROLES.ADMIN;
});

// Virtual for checking if user is locked
userSchema.virtual('isLocked').get(function() {
  return this.loginAttempts >= 5 || this.status === USER_STATUS.SUSPENDED;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  try {
    // Hash password with cost of 12
    const hashedPassword = await bcrypt.hash(this.password, 12);
    this.password = hashedPassword;
    next();
  } catch (error) {
    next(error);
  }
});

// Instance method to check password
userSchema.methods.checkPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to generate JWT token
userSchema.methods.generateToken = function() {
  return jwt.sign(
    { 
      id: this.id,
      username: this.username,
      role: this.role 
    },
    process.env.JWT_SECRET || 'fallback-secret',
    { 
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      issuer: 'user-management-system'
    }
  );
};

// Instance method to add permission
userSchema.methods.addPermission = function(permission) {
  if (!this.permissions.includes(permission)) {
    this.permissions.push(permission);
  }
};

// Instance method to remove permission
userSchema.methods.removePermission = function(permission) {
  this.permissions = this.permissions.filter(p => p !== permission);
};

// Instance method to check permission
userSchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission);
};

// Instance method to record successful login
userSchema.methods.recordLogin = function() {
  this.lastLogin = new Date();
  this.loginAttempts = 0;
};

// Instance method to record failed login attempt
userSchema.methods.recordFailedLogin = function() {
  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.status = USER_STATUS.SUSPENDED;
  }
};

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  this.loginAttempts = 0;
};

// Instance method to activate user
userSchema.methods.activate = function() {
  this.status = USER_STATUS.ACTIVE;
  this.loginAttempts = 0;
};

// Instance method to deactivate user
userSchema.methods.deactivate = function() {
  this.status = USER_STATUS.INACTIVE;
};

// Instance method to suspend user
userSchema.methods.suspend = function() {
  this.status = USER_STATUS.SUSPENDED;
};

// Instance method to delete user (soft delete)
userSchema.methods.delete = function() {
  this.status = USER_STATUS.DELETED;
};

// Instance method to get metadata
userSchema.methods.getMetadata = function(key, defaultValue = null) {
  return this.metadata[key] || defaultValue;
};

// Instance method to set metadata
userSchema.methods.setMetadata = function(key, value) {
  this.metadata[key] = value;
};

// Instance method to remove metadata
userSchema.methods.removeMetadata = function(key) {
  delete this.metadata[key];
};

// Instance method to validate user data
userSchema.methods.validateUser = function() {
  const errors = [];

  if (!this.username || this.username.length < 3) {
    errors.push('Username must be at least 3 characters');
  }

  if (!this.name || this.name.length === 0) {
    errors.push('Name is required');
  }

  if (this.age && (this.age < 0 || this.age > 150)) {
    errors.push('Age must be between 0 and 150');
  }

  if (this.email && !this.email.match(/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/)) {
    errors.push('Email format is invalid');
  }

  return errors;
};

// Static method to find by username
userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username });
};

// Static method to find by email
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email });
};

// Static method to find active users
userSchema.statics.findActive = function() {
  return this.find({ status: USER_STATUS.ACTIVE });
};

// Static method to find by role
userSchema.statics.findByRole = function(role) {
  return this.find({ role });
};

// Static method to search users
userSchema.statics.searchUsers = function(query, options = {}) {
  const searchRegex = new RegExp(query, 'i');
  const searchQuery = {
    $or: [
      { username: searchRegex },
      { name: searchRegex },
      { email: searchRegex },
    ],
  };

  return this.find(searchQuery, null, options);
};

// Static method to get user statistics
userSchema.statics.getUserStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ['$status', USER_STATUS.ACTIVE] }, 1, 0] } },
        admin: { $sum: { $cond: [{ $eq: ['$role', USER_ROLES.ADMIN] }, 1, 0] } },
        user: { $sum: { $cond: [{ $eq: ['$role', USER_ROLES.USER] }, 1, 0] } },
        guest: { $sum: { $cond: [{ $eq: ['$role', USER_ROLES.GUEST] }, 1, 0] } },
        withEmail: { $sum: { $cond: [{ $ne: ['$email', null] }, 1, 0] } },
      },
    },
  ]);

  return stats[0] || {
    total: 0,
    active: 0,
    admin: 0,
    user: 0,
    guest: 0,
    withEmail: 0,
  };
};

// Index for performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

// Export model and constants
const User = mongoose.model('User', userSchema);

module.exports = {
  User,
  USER_ROLES,
  USER_STATUS,
};