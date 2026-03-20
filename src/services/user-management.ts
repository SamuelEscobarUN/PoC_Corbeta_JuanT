/**
 * UserManagementService — admin-only service for managing platform users.
 *
 * Uses the AppSync custom query `manageUsers` which invokes a Lambda
 * that performs Cognito Admin API operations.
 */
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { UserProfile } from '../types/auth';
import type {
  CreateUserInput,
  UpdateUserInput,
  UserFilters,
  PaginatedResult,
} from '../types/user-management';

const client = generateClient<Schema>();

export class UserManagementService {
  private static instance: UserManagementService;

  private constructor() {}

  static getInstance(): UserManagementService {
    if (!UserManagementService.instance) {
      UserManagementService.instance = new UserManagementService();
    }
    return UserManagementService.instance;
  }

  /** For testing */
  static create(_baseUrl?: string): UserManagementService {
    return new UserManagementService();
  }

  private async call(action: string, payload?: Record<string, unknown>): Promise<unknown> {
    const { data, errors } = await client.queries.manageUsers({
      action,
      payload: payload ? JSON.stringify(payload) : undefined,
    });
    if (errors?.length) {
      throw new Error(errors[0].message);
    }
    return data ? JSON.parse(data as string) : null;
  }

  async listUsers(_filters?: UserFilters): Promise<PaginatedResult<UserProfile>> {
    const result = await this.call('list') as PaginatedResult<UserProfile>;
    return result;
  }

  async createUser(data: CreateUserInput): Promise<UserProfile> {
    const result = await this.call('create', {
      email: data.email,
      role: data.role,
    }) as UserProfile;
    return result;
  }

  async updateUser(userId: string, data: UpdateUserInput): Promise<UserProfile> {
    // Update role if changed
    if (data.role) {
      await this.call('assignRole', { username: userId, role: data.role });
    }
    return { userId, email: '', role: data.role ?? 'Operator', permissions: [], isActive: true };
  }

  async deactivateUser(userId: string): Promise<void> {
    await this.call('deactivate', { username: userId });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.call('delete', { username: userId });
  }

  async assignRole(userId: string, role: string, _permissions: string[]): Promise<void> {
    await this.call('assignRole', { username: userId, role });
  }
}

export const userManagementService = UserManagementService.getInstance();
