import { describe, expect, it, vi } from "vitest";
import type { OpenMeter } from "@openmeter/sdk";
import { provisionBillingCustomer } from "../src/billing/openmeter/provision.js";

function mockOpenMeter(overrides: Partial<OpenMeter>): OpenMeter {
  return {
    customers: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      create: vi.fn().mockResolvedValue({ id: "cust_1", key: "app:auth0|u" }),
      listSubscriptions: vi.fn().mockResolvedValue({ items: [] }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({ id: "sub_1", status: "active" }),
    },
    ...overrides,
  } as unknown as OpenMeter;
}

describe("provisionBillingCustomer", () => {
  it("creates customer and subscription when missing", async () => {
    const client = mockOpenMeter({});

    const result = await provisionBillingCustomer(client, {
      clientId: "app",
      externalUserId: "auth0|u",
      planKey: "plan_a",
    });

    expect(result.customerKey).toBe("app:auth0|u");
    expect(result.created).toEqual({ customer: true, subscription: true });
    expect(client.customers.create).toHaveBeenCalled();
    expect(client.subscriptions.create).toHaveBeenCalledWith({
      customerId: "cust_1",
      plan: { key: "plan_a" },
    });
  });

  it("reuses existing customer and subscription", async () => {
    const client = mockOpenMeter({
      customers: {
        list: vi.fn().mockResolvedValue({
          items: [{ id: "cust_existing", key: "app:auth0|u" }],
        }),
        create: vi.fn(),
        listSubscriptions: vi.fn().mockResolvedValue({
          items: [{ id: "sub_existing", status: "active", plan: { key: "plan_a" } }],
        }),
      } as OpenMeter["customers"],
      subscriptions: {
        create: vi.fn(),
      } as OpenMeter["subscriptions"],
    });

    const result = await provisionBillingCustomer(client, {
      clientId: "app",
      externalUserId: "auth0|u",
      planKey: "plan_a",
    });

    expect(result.created).toEqual({ customer: false, subscription: false });
    expect(result.subscriptionId).toBe("sub_existing");
    expect(client.customers.create).not.toHaveBeenCalled();
    expect(client.subscriptions.create).not.toHaveBeenCalled();
  });
});
