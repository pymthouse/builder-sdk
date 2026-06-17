import type { ManagementClient } from "auth0";
import type {
  EnsurePlatformUserInput,
  EnsurePlatformUserResult,
  UserProvisionerPort,
} from "../signer/webhook/ports/user.js";
import { ensureAuth0User } from "./management.js";

export type CreateAuth0UserProvisionerInput = {
  management: ManagementClient;
  defaultConnection?: string;
};

export function createAuth0UserProvisioner(
  input: CreateAuth0UserProvisionerInput,
): UserProvisionerPort {
  return {
    async ensureUser(userInput: EnsurePlatformUserInput): Promise<EnsurePlatformUserResult> {
      const result = await ensureAuth0User(input.management, {
        email: userInput.email,
        password: userInput.password,
        connection: userInput.connection ?? input.defaultConnection,
        name: userInput.name,
      });
      return {
        externalUserId: result.user.sub,
        created: result.created,
      };
    },
  };
}
