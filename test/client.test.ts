import { describe, expect, it } from "vitest";
import { buildDeviceCodeResource, normalizeUserCode, PmtHouseClient } from "../src/client.js";
import { PmtHouseError } from "../src/errors.js";

describe("normalizeUserCode", () => {
  it("uppercases and strips non-alphanumeric", () => {
    expect(normalizeUserCode("ab12-cd")).toBe("AB12CD");
  });
});

describe("buildDeviceCodeResource", () => {
  it("returns RFC 8707 urn with normalized code", () => {
    expect(buildDeviceCodeResource("ab-cd")).toBe("urn:pmth:device_code:ABCD");
  });
});

describe("PmtHouseClient.parseDeviceApprovalRedirect", () => {
  const client = new PmtHouseClient({
    issuerUrl: "https://issuer.example/api/v1/oidc",
    publicClientId: "app_x",
    m2mClientId: "m2m_x",
    m2mClientSecret: "secret",
  });

  it("parses valid initiate-login parameters", () => {
    const target = new URL("https://issuer.example/oidc/device");
    target.searchParams.set("user_code", "ABCD-EFGH");
    target.searchParams.set("client_id", "app_cli");
    const sp = new URLSearchParams();
    sp.set("iss", "https://issuer.example/api/v1/oidc");
    sp.set("target_link_uri", target.toString());

    const parsed = client.parseDeviceApprovalRedirect(sp);
    expect(parsed.userCode).toBe("ABCDEFGH");
    expect(parsed.clientId).toBe("app_cli");
  });
});

describe("PmtHouseClient.ensureUserAndMintToken", () => {
  const ISSUER = "https://pymthouse.example/api/v1/oidc";
  const USERS_URL = "https://pymthouse.example/api/v1/apps/app_pub/users";
  const TOKEN_URL = `${USERS_URL}/user-1/token`;

  function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function createClient(fetchImpl: typeof fetch): PmtHouseClient {
    return new PmtHouseClient({
      issuerUrl: ISSUER,
      publicClientId: "app_pub",
      m2mClientId: "m2m_1",
      m2mClientSecret: "secret",
      fetch: fetchImpl,
    });
  }

  const minted = {
    access_token: "eyJ.user.jwt",
    refresh_token: "refresh",
    token_type: "Bearer" as const,
    expires_in: 900,
    scope: "sign:job",
    subject_type: "app_user" as const,
  };

  it("mints once and does not upsert when the user already exists", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      urls.push(`${request.method} ${request.url}`);
      if (request.url === TOKEN_URL) {
        return json(minted);
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    const token = await createClient(fetchImpl).ensureUserAndMintToken({
      externalUserId: "user-1",
    });

    expect(token.access_token).toBe("eyJ.user.jwt");
    expect(urls).toEqual([`POST ${TOKEN_URL}`]);
  });

  it("upserts then retries mint on 404/not_found", async () => {
    const urls: string[] = [];
    let mintCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      urls.push(`${request.method} ${request.url}`);

      if (request.url === TOKEN_URL) {
        mintCalls += 1;
        if (mintCalls === 1) {
          return json({ error: "not_found" }, 404);
        }
        return json(minted);
      }

      if (request.url === USERS_URL && request.method === "POST") {
        const body = JSON.parse(await request.clone().text()) as {
          externalUserId: string;
          status?: string;
        };
        expect(body.externalUserId).toBe("user-1");
        expect(body.status).toBeUndefined();
        return json({
          id: "app-user-1",
          clientId: "app_pub",
          externalUserId: "user-1",
          email: null,
          status: "active",
          role: "end_user",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    const token = await createClient(fetchImpl).ensureUserAndMintToken({
      externalUserId: "user-1",
    });

    expect(token.access_token).toBe("eyJ.user.jwt");
    expect(urls).toEqual([
      `POST ${TOKEN_URL}`,
      `POST ${USERS_URL}`,
      `POST ${TOKEN_URL}`,
    ]);
  });

  it("does not upsert and rethrows non-not_found errors", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      urls.push(`${request.method} ${request.url}`);
      if (request.url === TOKEN_URL) {
        return json({ error: "invalid_scope", error_description: "scope denied" }, 400);
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    let thrown: unknown;
    try {
      await createClient(fetchImpl).ensureUserAndMintToken({ externalUserId: "user-1" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PmtHouseError);
    expect(thrown).toMatchObject({ status: 400, code: "invalid_scope" });
    expect(urls).toEqual([`POST ${TOKEN_URL}`]);
  });
});
