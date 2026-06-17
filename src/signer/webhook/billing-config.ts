import {
  createAuth0RemoteSignerWebhookConfig,
  type Auth0RemoteSignerWebhookConfigInput,
} from "./adapters/auth0/config.js";
import { createCustomerProvisionAdminRoutes } from "./admin/customers.js";
import { createLazyBillingProvisionHook } from "./admin/lazy-provision.js";
import type { BillingProvisionerPort } from "./ports/billing.js";
import type { UserProvisionerPort } from "./ports/user.js";
import type { RemoteSignerWebhookConfig } from "./authorize.js";

export type Auth0BillingWebhookConfigInput = Auth0RemoteSignerWebhookConfigInput & {
  billingProvisioner: BillingProvisionerPort;
  userProvisioner?: UserProvisionerPort;
  /** Fallback Konnect customer clientId for single-tenant hosts. */
  defaultBillingClientId?: string;
  strictBillingProvision?: boolean;
  onBillingProvisionError?: Parameters<typeof createLazyBillingProvisionHook>[0]["onError"];
  /** Mount POST /admin/customers on the webhook (optional; omit for platform-owned admin API). */
  adminRoutes?: boolean;
};

export function createAuth0BillingWebhookConfig(
  input: Auth0BillingWebhookConfigInput,
): RemoteSignerWebhookConfig {
  const {
    billingProvisioner,
    userProvisioner,
    defaultBillingClientId,
    strictBillingProvision,
    onBillingProvisionError,
    adminRoutes: mountAdminRoutes = true,
    ...webhookInput
  } = input;

  const adminRoutes = mountAdminRoutes
    ? createCustomerProvisionAdminRoutes({
        webhookSecret: input.webhookSecret,
        billingProvisioner,
        userProvisioner,
        defaultClientId: defaultBillingClientId,
      })
    : undefined;

  const config = createAuth0RemoteSignerWebhookConfig({
    ...webhookInput,
    adminRoutes,
  });

  const afterVerify = createLazyBillingProvisionHook({
    billingProvisioner,
    defaultClientId: defaultBillingClientId,
    strict: strictBillingProvision,
    onError: onBillingProvisionError,
  });

  return {
    ...config,
    afterVerify,
  };
}
