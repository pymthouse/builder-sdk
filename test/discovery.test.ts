import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { clearDiscoveryCache, fetchDiscoveryDocument } from "../src/discovery.js";

function urlFromFetchInput(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

describe("fetchDiscoveryDocument", () => {
  const issuer = "http://localhost:3001/api/v1/oidc";

  beforeEach(() => {
    clearDiscoveryCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearDiscoveryCache();
  });

  it("loads OIDC metadata and matches issuer (oauth4webapi)", async () => {
    const docJson = {
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    };

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const u = urlFromFetchInput(input);
      if (u.includes("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(docJson), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const doc = await fetchDiscoveryDocument(issuer, fetchMock, {
      allowInsecureHttp: true,
    });

    expect(doc.issuer).toBe(issuer);
    expect(doc.token_endpoint).toBe(`${issuer}/token`);
    expect(doc.jwks_uri).toBe(`${issuer}/jwks`);
    expect(fetchMock).toHaveBeenCalled();
  });
});
