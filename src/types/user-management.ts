/**
 * Type definitions for the User Management module.
 *
 * These interfaces define the inputs, filters, and pagination
 * structures used by the UserManagementService.
 */
import type { UserRole } from './auth';

/** Input for creating a new user via Cognito. */
export interface CreateUserInput {
  email: string;
  role: UserRole;
  /** Optional display name. */
  name?: string;
}

/** Input for updating an existing user. */
export interface UpdateUserInput {
  email?: string;
  name?: string;
  /** When provided, also triggers a role reassignment in Cognito. */
  role?: UserRole;
}

/** Filters for the listUsers query. */
export interface UserFilters {
  role?: UserRole;
  isActive?: boolean;
  /** Free-text search against email or name. */
  search?: string;
  /** 1-based page number. */
  page?: number;
  /** Items per page (default 20). */
  pageSize?: number;
}

/** Generic paginated result wrapper. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
