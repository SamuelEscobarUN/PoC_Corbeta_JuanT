import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface AppSyncEvent {
  arguments: {
    action: string;
    payload?: string;
  };
}

export const handler = async (event: AppSyncEvent): Promise<string> => {
  const { action, payload } = event.arguments;
  const data = payload ? JSON.parse(payload) : {};

  switch (action) {
    case 'list':
      return JSON.stringify(await listUsers());
    case 'create':
      return JSON.stringify(await createUser(data));
    case 'delete':
      return JSON.stringify(await deleteUser(data.username));
    case 'deactivate':
      return JSON.stringify(await deactivateUser(data.username));
    case 'assignRole':
      return JSON.stringify(await assignRole(data.username, data.role));
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function listUsers() {
  const { Users = [] } = await cognito.send(
    new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }),
  );

  const items = await Promise.all(
    Users.map(async (u) => {
      const username = u.Username!;
      const attrs = Object.fromEntries(
        (u.Attributes ?? []).map((a) => [a.Name, a.Value]),
      );

      const { Groups = [] } = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        }),
      );
      const groupNames = Groups.map((g) => g.GroupName!);
      const role = groupNames.includes('Administrator')
        ? 'Administrator'
        : 'Operator';

      return {
        userId: attrs['sub'] ?? username,
        email: attrs['email'] ?? '',
        role,
        groups: groupNames,
        isActive: u.Enabled ?? true,
        permissions: [],
        createdAt: u.UserCreateDate?.toISOString(),
        status: u.UserStatus,
      };
    }),
  );

  return { items, total: items.length, page: 1, pageSize: items.length };
}

async function createUser(data: { email: string; role?: string; temporaryPassword?: string }) {
  const { email, role = 'Operator', temporaryPassword = 'TempPass1!' } = data;

  const result = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      TemporaryPassword: temporaryPassword,
    }),
  );

  const username = result.User?.Username!;
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: role,
    }),
  );

  const attrs = Object.fromEntries(
    (result.User?.Attributes ?? []).map((a) => [a.Name, a.Value]),
  );

  return {
    userId: attrs['sub'] ?? username,
    email,
    role,
    permissions: [],
    isActive: true,
  };
}

async function deleteUser(username: string) {
  await cognito.send(
    new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
  );
  return { success: true };
}

async function deactivateUser(username: string) {
  await cognito.send(
    new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
  );
  return { success: true };
}

async function assignRole(username: string, newRole: string) {
  const { Groups = [] } = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
  );

  for (const g of Groups) {
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: g.GroupName!,
      }),
    );
  }

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: newRole,
    }),
  );

  return { success: true, role: newRole };
}
