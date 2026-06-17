import type { ManagementClient } from "auth0";
import type { OpenMeter } from "@openmeter/sdk";
import { ensureAuth0User } from "../../../auth0/management.js";
import { provisionBillingCustomer } from "../../../billing/openmeter/provision.js";
import { authenticateWebhookCaller } from "../authorize.js";
import type { WebhookAdminRoute } from "../verifier.js";

export type CreateCustomerProvisionAdminRoutesInput = {
  webhookSecret: string;
  openMeterClient: OpenMeter;
  clientId: string;
  planKey: string;
  auth0Management?: ManagementClient;
  defaultConnection?: string;
};

export type ProvisionCustomerRequestBody = {
  email?: string;
  password?: string;
  connection?: string;
  name?: string;
  externalUserId?: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function createCustomerProvisionAdminRoutes(
  input: CreateCustomerProvisionAdminRoutesInput,
): WebhookAdminRoute[] {
  const handler = async (request: Request): Promise<Response> => {
    if (!authenticateWebhookCaller(request, input.webhookSecret)) {
      return jsonResponse(401, { error: "unauthorized webhook caller" });
    }

    let body: ProvisionCustomerRequestBody;
    try {
      body = await readJsonBody<ProvisionCustomerRequestBody>(request);
    } catch {
      return jsonResponse(400, { error: "invalid request json" });
    }

    let externalUserId = body.externalUserId?.trim() ?? "";
    let auth0Created = false;

    if (!externalUserId) {
      if (!input.auth0Management) {
        return jsonResponse(400, {
          error: "externalUserId is required when Auth0 management is not configured",
        });
      }
      const email = body.email?.trim();
      if (!email) {
        return jsonResponse(400, { error: "email is required when externalUserId is omitted" });
      }

      const auth0Result = await ensureAuth0User(input.auth0Management, {
        email,
        password: body.password,
        connection: body.connection ?? input.defaultConnection,
        name: body.name,
      });
      externalUserId = auth0Result.user.sub;
      auth0Created = auth0Result.created;
    }

    try {
      const billing = await provisionBillingCustomer(input.openMeterClient, {
        clientId: input.clientId,
        externalUserId,
        planKey: input.planKey,
        displayName: body.name ?? body.email ?? externalUserId,
      });

      return jsonResponse(201, {
        externalUserId,
        auth0Created,
        ...billing,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "provision failed";
      return jsonResponse(500, { error: message });
    }
  };

  return [
    {
      method: "POST",
      pathname: "/admin/customers",
      handler,
    },
  ];
}
