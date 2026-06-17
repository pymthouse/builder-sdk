export type EnsurePlatformUserInput = {
  email: string;
  password?: string;
  connection?: string;
  name?: string;
};

export type EnsurePlatformUserResult = {
  externalUserId: string;
  created: boolean;
};

/**
 * Host-injected user provisioner (e.g. Auth0 Management). Optional for admin routes
 * when callers supply `externalUserId` directly.
 */
export type UserProvisionerPort = {
  ensureUser(input: EnsurePlatformUserInput): Promise<EnsurePlatformUserResult>;
};
