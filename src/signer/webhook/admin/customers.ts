import type { BillingProvisionerPort } from "../ports/billing.js";
import type { UserProvisionerPort } from "../ports/user.js";
import { authenticateWebhookCaller } from "../authorize.js";
import type { WebhookAdminRoute } from "../verifier.js";

export type CreateCustomerProvisionAdminRoutesInput = {
  webhookSecret: string;
  billingProvisioner: BillingProvisionerPort;
  /** Used when body omits externalUserId and email/password flow is needed. */
  userProvisioner?: UserProvisionerPort;
  /** Fallback clientId when not inferable from request (single-tenant hosts). */
  defaultClientId?: string;
};

export type ProvisionCustomerRequestBody = {
  email?: string;
  password?: string;
  connection?: string;
  name?: string;
  externalUserId?: string;
  clientId?: string;
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

    const clientId = body.clientId?.trim() || input.defaultClientId?.trim() || "";
    if (!clientId) {
      return jsonResponse(400, { error: "clientId is required" });
    }

    let externalUserId = body.externalUserId?.trim() ?? "";
    let auth0Created = false;

    if (!externalUserId) {
      if (!input.userProvisioner) {
        return jsonResponse(400, {
          error: "externalUserId is required when userProvisioner is not configured",
        });
      }
      const email = body.email?.trim();
      if (!email) {
        return jsonResponse(400, { error: "email is required when externalUserId is omitted" });
      }

      const userResult = await input.userProvisioner.ensureUser({
        email,
        password: body.password,
        connection: body.connection,
        name: body.name,
      });
      externalUserId = userResult.externalUserId;
      auth0Created = userResult.created;
    }

    try {
      const billing = await input.billingProvisioner.provisionCustomer({
        clientId,
        externalUserId,
        displayName: body.name ?? body.email ?? externalUserId,
      });

      return jsonResponse(201, {
        clientId,
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
