/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { BillingProvisionerPort } from "../src/signer/webhook/ports/billing.js";
import { createCustomerProvisionAdminRoutes } from "../src/signer/webhook/admin/customers.js";

function mockBillingProvisioner(): BillingProvisionerPort {
  return {
    provisionCustomer: vi.fn().mockResolvedValue({
      customerKey: "pub_client:auth0|u",
      customerId: "cust_1",
      subscriptionId: "sub_1",
      planKey: "default_plan",
      status: "active",
      created: { customer: true, subscription: true },
    }),
  };
}

describe("createCustomerProvisionAdminRoutes", () => {
  const routes = (billingProvisioner: BillingProvisionerPort) =>
    createCustomerProvisionAdminRoutes({
      webhookSecret: "whsec",
      billingProvisioner,
      defaultClientId: "pub_client",
    });

  it("rejects unauthorized callers", async () => {
    const [route] = routes(mockBillingProvisioner());
    const response = await route.handler(
      new Request("http://localhost/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalUserId: "auth0|u" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("provisions billing via injected port", async () => {
    const billingProvisioner = mockBillingProvisioner();
    const [route] = routes(billingProvisioner);
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
    expect(billingProvisioner.provisionCustomer).toHaveBeenCalledWith({
      clientId: "pub_client",
      externalUserId: "auth0|u",
      displayName: "auth0|u",
    });
  });

  it("accepts clientId in body for multi-tenant hosts", async () => {
    const billingProvisioner = mockBillingProvisioner();
    const [route] = createCustomerProvisionAdminRoutes({
      webhookSecret: "whsec",
      billingProvisioner,
    }).slice(0, 1);
    const response = await route.handler(
      new Request("http://localhost/admin/customers", {
        method: "POST",
        headers: {
          Authorization: "Bearer whsec",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId: "app_tenant_2", externalUserId: "auth0|u2" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(billingProvisioner.provisionCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "app_tenant_2", externalUserId: "auth0|u2" }),
    );
  });
});
