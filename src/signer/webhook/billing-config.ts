import type { ManagementClient } from "auth0";
import type { OpenMeter } from "@openmeter/sdk";
import {
  createAuth0RemoteSignerWebhookConfig,
  type Auth0RemoteSignerWebhookConfigInput,
} from "./adapters/auth0/config.js";
import { createCustomerProvisionAdminRoutes } from "./admin/customers.js";
import { createLazyBillingProvisionHook } from "./admin/lazy-provision.js";
import type { RemoteSignerWebhookConfig } from "./authorize.js";

export type Auth0BillingWebhookConfigInput = Auth0RemoteSignerWebhookConfigInput & {
  openMeterClient: OpenMeter;
  billingClientId: string;
  planKey: string;
  auth0Management?: ManagementClient;
  defaultAuth0Connection?: string;
  strictBillingProvision?: boolean;
  onBillingProvisionError?: Parameters<typeof createLazyBillingProvisionHook>[0]["onError"];
};

export function createAuth0BillingWebhookConfig(
  input: Auth0BillingWebhookConfigInput,
): RemoteSignerWebhookConfig {
  const adminRoutes = createCustomerProvisionAdminRoutes({
    webhookSecret: input.webhookSecret,
    openMeterClient: input.openMeterClient,
    clientId: input.billingClientId,
    planKey: input.planKey,
    auth0Management: input.auth0Management,
    defaultConnection: input.defaultAuth0Connection,
  });

  const {
    openMeterClient,
    billingClientId,
    planKey,
    auth0Management,
    defaultAuth0Connection,
    strictBillingProvision,
    onBillingProvisionError,
    ...webhookInput
  } = input;

  const config = createAuth0RemoteSignerWebhookConfig({
    ...webhookInput,
    adminRoutes,
  });

  const afterVerify = createLazyBillingProvisionHook({
    openMeterClient,
    clientId: billingClientId,
    planKey,
    strict: strictBillingProvision,
    onError: onBillingProvisionError,
  });

  return {
    ...config,
    afterVerify,
  };
}
