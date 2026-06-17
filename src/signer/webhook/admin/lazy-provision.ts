import type { BillingProvisionerPort } from "../ports/billing.js";
import type { WebhookAuthorizeContext } from "../authorize.js";

export type LazyBillingProvisionHookInput = {
  billingProvisioner: BillingProvisionerPort;
  /** Fallback when JWT identity lacks client_id (single-tenant hosts). */
  defaultClientId?: string;
  strict?: boolean;
  onError?: (error: unknown, context: WebhookAuthorizeContext) => void;
};

export function createLazyBillingProvisionHook(
  input: LazyBillingProvisionHookInput,
): (context: WebhookAuthorizeContext) => Promise<void> {
  const defaultClientId = input.defaultClientId?.trim();

  return async (context) => {
    const externalUserId = context.identity.usage_subject?.trim();
    const clientId = context.identity.client_id?.trim() || defaultClientId;

    if (!clientId || !externalUserId) {
      const err = new Error("missing client_id or usage_subject for billing provision");
      if (input.strict) {
        throw err;
      }
      input.onError?.(err, context);
      return;
    }

    try {
      await input.billingProvisioner.provisionCustomer({
        clientId,
        externalUserId,
      });
    } catch (err) {
      if (input.strict) {
        throw err;
      }
      input.onError?.(err, context);
    }
  };
}
