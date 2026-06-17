import type { OpenMeter } from "@openmeter/sdk";
import { buildOpenMeterCustomerKey } from "./customer-key.js";
import { ensureOpenMeterCustomer } from "./customers.js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "scheduled",
  "pending",
]);

export type ProvisionBillingCustomerInput = {
  clientId: string;
  externalUserId: string;
  planKey: string;
  displayName?: string;
};

export type ProvisionBillingCustomerResult = {
  customerKey: string;
  customerId: string;
  subscriptionId: string;
  planKey: string;
  status: string;
  created: {
    customer: boolean;
    subscription: boolean;
  };
};

async function ensureCustomerSubscription(
  client: OpenMeter,
  input: {
    customerId: string;
    planKey: string;
  },
): Promise<{ subscriptionId: string; status: string; created: boolean }> {
  const listed = await client.customers.listSubscriptions(input.customerId, {
    page: 1,
    pageSize: 100,
  });
  const items = listed?.items ?? [];
  const match = items.find((sub) => {
    const planKey =
      (typeof sub.plan?.key === "string" ? sub.plan.key : null) ??
      (typeof (sub as { planKey?: string }).planKey === "string"
        ? (sub as { planKey?: string }).planKey
        : null);
    return planKey === input.planKey && ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status);
  });
  if (match?.id) {
    return {
      subscriptionId: match.id,
      status: match.status,
      created: false,
    };
  }

  const created = await client.subscriptions.create({
    customerId: input.customerId,
    plan: { key: input.planKey },
  });
  if (!created?.id) {
    throw new Error(`OpenMeter subscription create failed for plan ${input.planKey}`);
  }

  return {
    subscriptionId: created.id,
    status: created.status,
    created: true,
  };
}

export async function provisionBillingCustomer(
  client: OpenMeter,
  input: ProvisionBillingCustomerInput,
): Promise<ProvisionBillingCustomerResult> {
  const customerKey = buildOpenMeterCustomerKey(input.clientId, input.externalUserId);

  const customer = await ensureOpenMeterCustomer(
    client,
    customerKey,
    input.displayName ?? customerKey,
  );
  const subscription = await ensureCustomerSubscription(client, {
    customerId: customer.id,
    planKey: input.planKey,
  });

  return {
    customerKey,
    customerId: customer.id,
    subscriptionId: subscription.subscriptionId,
    planKey: input.planKey,
    status: subscription.status,
    created: {
      customer: customer.created,
      subscription: subscription.created,
    },
  };
}
