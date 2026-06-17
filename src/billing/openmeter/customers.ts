import type { OpenMeter } from "@openmeter/sdk";
import { buildOpenMeterCustomerKey } from "./customer-key.js";

export type OpenMeterCustomerIdentity = {
  id: string;
  key: string;
};

async function findOpenMeterCustomerByKey(
  client: OpenMeter,
  customerKey: string,
): Promise<{ id: string; key?: string } | null> {
  const listed = await client.customers.list({
    key: customerKey,
    page: 1,
    pageSize: 100,
  });
  const match = listed?.items?.find((item) => item.key === customerKey);
  if (match?.id) {
    return { id: match.id, key: match.key };
  }

  try {
    const direct = await client.customers.get(customerKey);
    if (direct?.id) {
      return { id: direct.id, key: direct.key };
    }
  } catch {
    return null;
  }

  return null;
}

export async function ensureOpenMeterCustomer(
  client: OpenMeter,
  customerKey: string,
  displayName?: string,
): Promise<OpenMeterCustomerIdentity & { created: boolean }> {
  const existing = await findOpenMeterCustomerByKey(client, customerKey);
  if (existing?.id) {
    return { id: existing.id, key: customerKey, created: false };
  }

  const created = await client.customers.create({
    key: customerKey,
    name: displayName || customerKey,
    usageAttribution: { subjectKeys: [customerKey] },
  });
  if (!created?.id) {
    throw new Error(`OpenMeter customer create failed for key ${customerKey}`);
  }
  return { id: created.id, key: customerKey, created: true };
}

export async function ensureOpenMeterCustomerForAppUser(input: {
  client: OpenMeter;
  clientId: string;
  externalUserId: string;
  displayName?: string;
}): Promise<OpenMeterCustomerIdentity> {
  const key = buildOpenMeterCustomerKey(input.clientId, input.externalUserId);
  return ensureOpenMeterCustomer(input.client, key, input.displayName);
}
