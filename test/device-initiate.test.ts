import { describe, expect, it } from "vitest";

import {
  extractDeviceApprovalFromTargetLink,
  USER_CODE_RE,
  validateDeviceInitiateLogin,
} from "../src/device-initiate.js";

describe("device-initiate", () => {
  const issuer = "http://localhost:3001/api/v1/oidc";

  it("USER_CODE_RE rejects all-dash codes", () => {
    expect(USER_CODE_RE.test("----")).toBe(false);
    expect(USER_CODE_RE.test("ABCD-EFGH")).toBe(true);
  });

  it("validateDeviceInitiateLogin accepts valid device URL", () => {
    const target = new URL("http://localhost:3001/oidc/device");
    target.searchParams.set("user_code", "ABCD-EFGH");
    target.searchParams.set("client_id", "app_test");
    const r = validateDeviceInitiateLogin({
      expectedIssuerUrl: issuer,
      iss: issuer,
      targetLinkUri: target.href,
    });
    expect(r.ok).toBe(true);
  });

  it("validateDeviceInitiateLogin rejects iss mismatch", () => {
    const target = new URL("http://localhost:3001/oidc/device");
    const r = validateDeviceInitiateLogin({
      expectedIssuerUrl: issuer,
      iss: "http://evil.example/api/v1/oidc",
      targetLinkUri: target.href,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("iss_mismatch");
  });

  it("extractDeviceApprovalFromTargetLink parses user_code and client_id", () => {
    const u = new URL("http://localhost:3001/oidc/device");
    u.searchParams.set("user_code", "ABCD-EFGH");
    u.searchParams.set("client_id", "app_testpublic123");
    const r = extractDeviceApprovalFromTargetLink(u.href, {
      expectedIssuerUrl: issuer,
      expectedPublicClientId: "app_testpublic123",
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.userCode).toBe("ABCD-EFGH");
    expect(r.publicClientId).toBe("app_testpublic123");
  });

  it("extractDeviceApprovalFromTargetLink rejects client_id mismatch", () => {
    const u = new URL("http://localhost:3001/oidc/device");
    u.searchParams.set("user_code", "ABCD-EFGH");
    u.searchParams.set("client_id", "app_other");
    const r = extractDeviceApprovalFromTargetLink(u.href, {
      expectedIssuerUrl: issuer,
      expectedPublicClientId: "app_testpublic123",
    });
    expect("error" in r).toBe(true);
  });
});
