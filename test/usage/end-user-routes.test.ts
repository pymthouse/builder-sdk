/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  assertClientIdMatch,
  assertNoCrossUserQueryParams,
  assertUsageReadScope,
  matchUsageMeRoute,
} from "../../src/usage/end-user-auth.js";
import { routeEndUserUsageRequest } from "../../src/usage/end-user-routes.js";
import { PmtHouseError } from "../../src/errors.js";

describe("matchUsageMeRoute", () => {
  it("matches balance route", () => {
    expect(
      matchUsageMeRoute("/api/v1/apps/app_x/usage/me/balance"),
    ).toEqual({ kind: "balance", clientId: "app_x" });
  });

  it("matches usage route", () => {
    expect(matchUsageMeRoute("/api/v1/apps/app_x/usage/me")).toEqual({
      kind: "usage",
      clientId: "app_x",
    });
  });

  it("returns null for unrelated paths", () => {
    expect(matchUsageMeRoute("/api/v1/apps/app_x/usage/balance")).toBeNull();
    expect(matchUsageMeRoute("/authorize")).toBeNull();
  });
});

describe("assertNoCrossUserQueryParams", () => {
  it("rejects externalUserId", () => {
    const params = new URLSearchParams({ externalUserId: "other-user" });
    expect(() => assertNoCrossUserQueryParams(params)).toThrow(PmtHouseError);
  });

  it("rejects userId", () => {
    const params = new URLSearchParams({ userId: "other-user" });
    expect(() => assertNoCrossUserQueryParams(params)).toThrow(PmtHouseError);
  });

  it("rejects groupBy=user", () => {
    const params = new URLSearchParams({ groupBy: "user" });
    expect(() => assertNoCrossUserQueryParams(params)).toThrow(PmtHouseError);
  });

  it("allows date filters", () => {
    const params = new URLSearchParams({
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-31T23:59:59.999Z",
    });
    expect(() => assertNoCrossUserQueryParams(params)).not.toThrow();
  });
});

describe("assertUsageReadScope", () => {
  const identity = {
    issuer: "https://auth.test",
    client_id: "app-1",
    usage_subject: "user-42",
    usage_subject_type: "external_user_id",
  };

  it("accepts sign:job scope", () => {
    expect(() =>
      assertUsageReadScope({
        identity,
        expiry: 4_102_444_800,
        raw: { scope: "sign:job" },
      }),
    ).not.toThrow();
  });

  it("accepts usage:read scope", () => {
    expect(() =>
      assertUsageReadScope({
        identity,
        expiry: 4_102_444_800,
        raw: { scope: "usage:read" },
      }),
    ).not.toThrow();
  });

  it("accepts api key resolve results", () => {
    expect(() =>
      assertUsageReadScope({
        identity,
        expiry: 4_102_444_800,
        raw: { userId: "user-42" },
      }),
    ).not.toThrow();
  });

  it("rejects missing scope on jwt claims", () => {
    expect(() =>
      assertUsageReadScope({
        identity,
        expiry: 4_102_444_800,
        raw: { scope: "openid" },
      }),
    ).toThrow(PmtHouseError);
  });
});

describe("assertClientIdMatch", () => {
  it("throws 404 on tenant mismatch", () => {
    expect(() =>
      assertClientIdMatch(
        {
          issuer: "https://auth.test",
          client_id: "app-a",
          usage_subject: "user-1",
          usage_subject_type: "external_user_id",
        },
        "app-b",
      ),
    ).toThrow(PmtHouseError);
  });
});

describe("routeEndUserUsageRequest", () => {
  const endUserAuth = {
    kind: "custom" as const,
    verify: async () => ({
      identity: {
        issuer: "https://auth.test",
        client_id: "app_x",
        usage_subject: "user-42",
        usage_subject_type: "external_user_id",
      },
      expiry: 4_102_444_800,
      raw: { scope: "sign:job" },
    }),
  };

  it("returns balance for authenticated user", async () => {
    const request = new Request(
      "http://localhost/api/v1/apps/app_x/usage/me/balance",
      {
        method: "GET",
        headers: { Authorization: "Bearer good-token" },
      },
    );

    const response = await routeEndUserUsageRequest(request, {
      endUserAuth,
      readBalance: async () => ({
        externalUserId: "user-42",
        balanceUsdMicros: "5000000",
        consumedUsdMicros: "1000000",
        lifetimeGrantedUsdMicros: "6000000",
        hasAccess: true,
        remainingUsdMicros: "5000000",
      }),
    });

    expect(response?.status).toBe(200);
    const body = await response!.json();
    expect(body.clientId).toBe("app_x");
    expect(body.externalUserId).toBe("user-42");
    expect(body.balanceUsdMicros).toBe("5000000");
  });

  it("rejects cross-user query params", async () => {
    const request = new Request(
      "http://localhost/api/v1/apps/app_x/usage/me/balance?externalUserId=other-user",
      {
        method: "GET",
        headers: { Authorization: "Bearer good-token" },
      },
    );

    const response = await routeEndUserUsageRequest(request, {
      endUserAuth,
      readBalance: async () => ({
        externalUserId: "user-42",
        balanceUsdMicros: "0",
        consumedUsdMicros: "0",
        lifetimeGrantedUsdMicros: "0",
        hasAccess: false,
      }),
    });

    expect(response?.status).toBe(400);
  });

  it("returns 404 for client id mismatch", async () => {
    const request = new Request(
      "http://localhost/api/v1/apps/other-app/usage/me/balance",
      {
        method: "GET",
        headers: { Authorization: "Bearer good-token" },
      },
    );

    const response = await routeEndUserUsageRequest(request, {
      endUserAuth,
      readBalance: async () => ({
        externalUserId: "user-42",
        balanceUsdMicros: "0",
        consumedUsdMicros: "0",
        lifetimeGrantedUsdMicros: "0",
        hasAccess: false,
      }),
    });

    expect(response?.status).toBe(404);
  });

  it("returns null for unrelated routes", async () => {
    const request = new Request("http://localhost/authorize", { method: "POST" });
    const response = await routeEndUserUsageRequest(request, {
      endUserAuth,
      readBalance: async () => ({
        externalUserId: "user-42",
        balanceUsdMicros: "0",
        consumedUsdMicros: "0",
        lifetimeGrantedUsdMicros: "0",
        hasAccess: false,
      }),
    });
    expect(response).toBeNull();
  });
});
