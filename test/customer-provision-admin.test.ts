/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { OpenMeter } from "@openmeter/sdk";
import { createCustomerProvisionAdminRoutes } from "../src/signer/webhook/admin/customers.js";

function mockOpenMeter(): OpenMeter {
  return {
    customers: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      create: vi.fn().mockResolvedValue({ id: "cust_1" }),
      listSubscriptions: vi.fn().mockResolvedValue({ items: [] }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({ id: "sub_1", status: "active" }),
    },
  } as unknown as OpenMeter;
}

describe("createCustomerProvisionAdminRoutes", () => {
  const routes = () =>
    createCustomerProvisionAdminRoutes({
      webhookSecret: "whsec",
      openMeterClient: mockOpenMeter(),
      clientId: "pub_client",
      planKey: "default_plan",
    });

  it("rejects unauthorized callers", async () => {
    const [route] = routes();
    const response = await route.handler(
      new Request("http://localhost/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalUserId: "auth0|u" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("provisions billing for externalUserId", async () => {
    const [route] = routes();
    const response = await route.handler(
      new Request("http://localhost/admin/customers", {
        method: "POST",
        headers: {
          Authorization: "Bearer whsec",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ externalUserId: "auth0|u" }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.externalUserId).toBe("auth0|u");
    expect(body.customerKey).toBe("pub_client:auth0|u");
  });
});
