import { describe, expect, it, vi } from "vitest";
import type { OpenMeter } from "@openmeter/sdk";
import { createOpenMeterBillingProvisioner } from "../src/billing/openmeter/billing-provisioner.js";

describe("createOpenMeterBillingProvisioner", () => {
  it("delegates to provisionBillingCustomer with resolved plan key", async () => {
    const client = {
      customers: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        create: vi.fn().mockResolvedValue({ id: "cust_1" }),
        listSubscriptions: vi.fn().mockResolvedValue({ items: [] }),
      },
      subscriptions: {
        create: vi.fn().mockResolvedValue({ id: "sub_1", status: "active" }),
      },
    } as unknown as OpenMeter;

    const provisioner = createOpenMeterBillingProvisioner({
      client,
      resolvePlanKey: () => "plan_a",
    });

    const result = await provisioner.provisionCustomer({
      clientId: "app_1",
      externalUserId: "auth0|u",
    });

    expect(result.customerKey).toBe("app_1:auth0|u");
    expect(result.planKey).toBe("plan_a");
  });
});
