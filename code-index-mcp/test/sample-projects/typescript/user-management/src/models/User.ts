import mongoose, { Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import {
  IUser,
  IUserDocument,
  IUserResponse,
  IUserStats,
  UserRole,
  UserStatus,
  IJWTPayload,
} from '../types/User';

// User schema definition
const userSchema = new Schema<IUserDocument>(
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
      match: [
        /^[a-zA-Z0-9_]+$/,
        'Username can only contain letters, numbers, and underscores',
      ],
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please enter a valid email',
      ],
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
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
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
      type: Schema.Types.Mixed,
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
userSchema.virtual('response').get(function (this: IUserDocument): IUserResponse {
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
userSchema.virtual('isActive').get(function (this: IUserDocument): boolean {
  return this.status === UserStatus.ACTIVE;
});

// Virtual for checking if user is admin
userSchema.virtual('isAdmin').get(function (this: IUserDocument): boolean {
  return this.role === UserRole.ADMIN;
});

// Virtual for checking if user is locked
userSchema.virtual('isLocked').get(function (this: IUserDocument): boolean {
  return this.loginAttempts >= 5 || this.status === UserStatus.SUSPENDED;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function (this: IUserDocument, next) {
  if (!this.isModified('password')) return next();

  try {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
    const hashedPassword = await bcrypt.hash(this.password, saltRounds);
    this.password = hashedPassword;
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Instance method to check password
userSchema.methods.checkPassword = async function (
  this: IUserDocument,
  candidatePassword: string
): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to generate JWT token
userSchema.methods.generateToken = function (this: IUserDocument): string {
  const payload: IJWTPayload = {
    id: this.id,
    username: this.username,
    role: this.role,
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'fallback-secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: 'user-management-system',
  });
};

// Instance method to add permission
userSchema.methods.addPermission = function (
  this: IUserDocument,
  permission: string
): void {
  if (!this.permissions.includes(permission)) {
    this.permissions.push(permission);
  }
};

// Instance method to remove permission
userSchema.methods.removePermission = function (
  this: IUserDocument,
  permission: string
): void {
  this.permissions = this.permissions.filter(p => p !== permission);
};

// Instance method to check permission
userSchema.methods.hasPermission = function (
  this: IUserDocument,
  permission: string
): boolean {
  return this.permissions.includes(permission);
};

// Instance method to record successful login
userSchema.methods.recordLogin = function (this: IUserDocument): void {
  this.lastLogin = new Date();
  this.loginAttempts = 0;
};

// Instance method to record failed login attempt
userSchema.methods.recordFailedLogin = function (this: IUserDocument): void {
  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.status = UserStatus.SUSPENDED;
  }
};

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function (this: IUserDocument): void {
  this.loginAttempts = 0;
};

// Instance method to activate user
userSchema.methods.activate = function (this: IUserDocument): void {
  this.status = UserStatus.ACTIVE;
  this.loginAttempts = 0;
};

// Instance method to deactivate user
userSchema.methods.deactivate = function (this: IUserDocument): void {
  this.status = UserStatus.INACTIVE;
};

// Instance method to suspend user
userSchema.methods.suspend = function (this: IUserDocument): void {
  this.status = UserStatus.SUSPENDED;
};

// Instance method to delete user (soft delete)
userSchema.methods.delete = function (this: IUserDocument): void {
  this.status = UserStatus.DELETED;
};

// Instance method to get metadata
userSchema.methods.getMetadata = function (
  this: IUserDocument,
  key: string,
  defaultValue: any = null
): any {
  return this.metadata[key] || defaultValue;
};

// Instance method to set metadata
userSchema.methods.setMetadata = function (
  this: IUserDocument,
  key: string,
  value: any
): void {
  this.metadata[key] = value;
};

// Instance method to remove metadata
userSchema.methods.removeMetadata = function (
  this: IUserDocument,
  key: string
): void {
  delete this.metadata[key];
};

// Instance method to validate user data
userSchema.methods.validateUser = function (this: IUserDocument): string[] {
  const errors: string[] = [];

  if (!this.username || this.username.length < 3) {
    errors.push('Username must be at least 3 characters');
  }

  if (!this.name || this.name.length === 0) {
    errors.push('Name is required');
  }

  if (this.age && (this.age < 0 || this.age > 150)) {
    errors.push('Age must be between 0 and 150');
  }

  if (
    this.email &&
    !this.email.match(/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/)
  ) {
    errors.push('Email format is invalid');
  }

  return errors;
};

// Static method to find by username
userSchema.statics.findByUsername = function (
  this: Model<IUserDocument>,
  username: string
) {
  return this.findOne({ username });
};

// Static method to find by email
userSchema.statics.findByEmail = function (
  this: Model<IUserDocument>,
  email: string
) {
  return this.findOne({ email });
};

// Static method to find active users
userSchema.statics.findActive = function (this: Model<IUserDocument>) {
  return this.find({ status: UserStatus.ACTIVE });
};

// Static method to find by role
userSchema.statics.findByRole = function (
  this: Model<IUserDocument>,
  role: UserRole
) {
  return this.find({ role });
};

// Static method to search users
userSchema.statics.searchUsers = function (
  this: Model<IUserDocument>,
  query: string,
  options: any = {}
) {
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
userSchema.statics.getUserStats = async function (
  this: Model<IUserDocument>
): Promise<IUserStats> {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: {
          $sum: { $cond: [{ $eq: ['$status', UserStatus.ACTIVE] }, 1, 0] },
        },
        admin: {
          $sum: { $cond: [{ $eq: ['$role', UserRole.ADMIN] }, 1, 0] },
        },
        user: {
          $sum: { $cond: [{ $eq: ['$role', UserRole.USER] }, 1, 0] },
        },
        guest: {
          $sum: { $cond: [{ $eq: ['$role', UserRole.GUEST] }, 1, 0] },
        },
        withEmail: { $sum: { $cond: [{ $ne: ['$email', null] }, 1, 0] } },
      },
    },
  ]);

  return (
    stats[0] || {
      total: 0,
      active: 0,
      admin: 0,
      user: 0,
      guest: 0,
      withEmail: 0,
    }
  );
};

// Indexes for performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

// Interface for the model
interface IUserModel extends Model<IUserDocument> {
  findByUsername(username: string): Promise<IUserDocument | null>;
  findByEmail(email: string): Promise<IUserDocument | null>;
  findActive(): Promise<IUserDocument[]>;
  findByRole(role: UserRole): Promise<IUserDocument[]>;
  searchUsers(query: string, options?: any): Promise<IUserDocument[]>;
  getUserStats(): Promise<IUserStats>;
}

// Export model and types
const User = mongoose.model<IUserDocument, IUserModel>('User', userSchema);

export { User, UserRole, UserStatus };
export default User;