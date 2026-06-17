import { ManagementClient } from "auth0";

export type Auth0ManagementConfig = {
  domain: string;
  clientId: string;
  clientSecret: string;
};

export type Auth0UserIdentity = {
  userId: string;
  sub: string;
  email?: string;
};

export type EnsureAuth0UserInput = {
  email: string;
  connection?: string;
  password?: string;
  name?: string;
};

export function createAuth0ManagementClient(
  config: Auth0ManagementConfig,
): ManagementClient {
  return new ManagementClient({
    domain: config.domain,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
}

function readUserSub(user: { user_id?: string }): string {
  const sub = user.user_id?.trim();
  if (!sub) {
    throw new Error("Auth0 user missing user_id");
  }
  return sub;
}

export async function findAuth0UserByEmail(
  management: ManagementClient,
  email: string,
): Promise<Auth0UserIdentity | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const response = await management.usersByEmail.getByEmail({ email: normalized });
  const users = response.data ?? [];
  const match = users.find(
    (user: { email?: string }) => user.email?.trim().toLowerCase() === normalized,
  );
  if (!match) {
    return null;
  }

  return {
    userId: readUserSub(match),
    sub: readUserSub(match),
    email: match.email ?? normalized,
  };
}

export async function ensureAuth0User(
  management: ManagementClient,
  input: EnsureAuth0UserInput,
): Promise<{ user: Auth0UserIdentity; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("email is required");
  }

  const existing = await findAuth0UserByEmail(management, email);
  if (existing) {
    return { user: existing, created: false };
  }

  const connection = input.connection?.trim() || "Username-Password-Authentication";
  const password = input.password?.trim();
  if (!password) {
    throw new Error("password is required when creating a new Auth0 user");
  }

  const created = await management.users.create({
    email,
    connection,
    password,
    name: input.name?.trim() || email,
    email_verified: false,
  });

  const user = created.data;
  return {
    user: {
      userId: readUserSub(user),
      sub: readUserSub(user),
      email: user.email ?? email,
    },
    created: true,
  };
}
