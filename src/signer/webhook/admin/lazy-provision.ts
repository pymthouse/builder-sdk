import type { OpenMeter } from "@openmeter/sdk";
import { provisionBillingCustomer } from "../../../billing/openmeter/provision.js";
import type { WebhookAuthorizeContext } from "../authorize.js";

export type LazyBillingProvisionHookInput = {
  openMeterClient: OpenMeter;
  clientId: string;
  planKey: string;
  strict?: boolean;
  onError?: (error: unknown, context: WebhookAuthorizeContext) => void;
};

export function createLazyBillingProvisionHook(
  input: LazyBillingProvisionHookInput,
): (context: WebhookAuthorizeContext) => Promise<void> {
  const resolvedClientId = input.clientId.trim();
  const planKey = input.planKey.trim();

  return async (context) => {
    const externalUserId = context.identity.usage_subject?.trim();
    const clientId = context.identity.client_id?.trim() || resolvedClientId;

    if (!clientId || !externalUserId) {
      const err = new Error("missing client_id or usage_subject for billing provision");
      if (input.strict) {
        throw err;
      }
      input.onError?.(err, context);
      return;
    }

    try {
      await provisionBillingCustomer(input.openMeterClient, {
        clientId,
        externalUserId,
        planKey,
      });
    } catch (err) {
      if (input.strict) {
        throw err;
      }
      input.onError?.(err, context);
    }
  };
}
