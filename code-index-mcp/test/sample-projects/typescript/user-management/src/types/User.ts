import { Document } from 'mongoose';

// User roles enumeration
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest',
}

// User status enumeration
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

// Base user interface
export interface IUser {
  id: string;
  username: string;
  email?: string;
  name: string;
  age?: number;
  password: string;
  role: UserRole;
  status: UserStatus;
  lastLogin?: Date;
  loginAttempts: number;
  permissions: string[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// User response interface (without sensitive data)
export interface IUserResponse {
  id: string;
  username: string;
  email?: string;
  name: string;
  age?: number;
  role: UserRole;
  status: UserStatus;
  lastLogin?: Date;
  permissions: string[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// User creation interface
export interface ICreateUser {
  username: string;
  email?: string;
  name: string;
  age?: number;
  password: string;
  role?: UserRole;
  status?: UserStatus;
  permissions?: string[];
  metadata?: Record<string, any>;
}

// User update interface
export interface IUpdateUser {
  username?: string;
  email?: string;
  name?: string;
  age?: number;
  role?: UserRole;
  status?: UserStatus;
  permissions?: string[];
  metadata?: Record<string, any>;
}

// User document interface (extends Mongoose Document)
export interface IUserDocument extends IUser, Document {
  // Virtual properties
  isActive: boolean;
  isAdmin: boolean;
  isLocked: boolean;
  response: IUserResponse;

  // Instance methods
  checkPassword(candidatePassword: string): Promise<boolean>;
  generateToken(): string;
  addPermission(permission: string): void;
  removePermission(permission: string): void;
  hasPermission(permission: string): boolean;
  recordLogin(): void;
  recordFailedLogin(): void;
  resetLoginAttempts(): void;
  activate(): void;
  deactivate(): void;
  suspend(): void;
  delete(): void;
  getMetadata(key: string, defaultValue?: any): any;
  setMetadata(key: string, value: any): void;
  removeMetadata(key: string): void;
  validateUser(): string[];
}

// User statistics interface
export interface IUserStats {
  total: number;
  active: number;
  admin: number;
  user: number;
  guest: number;
  withEmail: number;
}

// Authentication result interface
export interface IAuthResult {
  user: IUserResponse;
  token: string;
}

// User activity interface
export interface IUserActivity {
  id: string;
  username: string;
  lastLogin?: Date;
  loginAttempts: number;
  isActive: boolean;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Pagination interface
export interface IPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Paginated users response
export interface IPaginatedUsers {
  users: IUserResponse[];
  pagination: IPagination;
}

// Search users response
export interface ISearchUsersResponse {
  users: IUserResponse[];
  query: string;
  pagination: IPagination;
}

// Password change interface
export interface IPasswordChange {
  currentPassword: string;
  newPassword: string;
}

// User filter interface
export interface IUserFilter {
  role?: UserRole;
  status?: UserStatus;
  hasEmail?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

// JWT payload interface
export interface IJWTPayload {
  id: string;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// Request with user interface
export interface IAuthenticatedRequest extends Request {
  user?: IUserDocument;
  requestId?: string;
}

// API response interface
export interface IApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    message: string;
    statusCode: number;
    errors?: any[];
    stack?: string;
  };
}

// Validation error interface
export interface IValidationError {
  field: string;
  message: string;
  value: any;
}