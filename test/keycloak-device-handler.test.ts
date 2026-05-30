import { describe, expect, it } from "vitest";
import {
  extractDeviceApprovalFromKeycloakTargetLink,
  validateDeviceInitiateLoginForKeycloak,
} from "../src/device-initiate.js";
import { createKeycloakDeviceLoginHandler } from "../src/keycloak-device-handler.js";

const ISSUER = "http://127.0.0.1:8080/realms/clearinghouse";

describe("validateDeviceInitiateLoginForKeycloak", () => {
  it("accepts Keycloak device target_link_uri", () => {
    const target = `${ISSUER}/device?user_code=ABCD-EFGH&client_id=app_demo&iss=${encodeURIComponent(ISSUER)}`;
    const result = validateDeviceInitiateLoginForKeycloak({
      expectedIssuerUrl: ISSUER,
      iss: ISSUER,
      targetLinkUri: target,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.returnUrl).toBe(target);
    }
  });

  it("rejects PymtHouse /oidc/device path", () => {
    const target = `http://localhost:3001/oidc/device?user_code=ABCD-EFGH&client_id=app_demo`;
    const result = validateDeviceInitiateLoginForKeycloak({
      expectedIssuerUrl: ISSUER,
      iss: ISSUER,
      targetLinkUri: target,
    });
    expect(result.ok).toBe(false);
  });
});

describe("extractDeviceApprovalFromKeycloakTargetLink", () => {
  it("parses user_code and client_id", () => {
    const href = `${ISSUER}/device?user_code=GRUB-MNBZ&client_id=app_demo`;
    const parsed = extractDeviceApprovalFromKeycloakTargetLink(href, {
      expectedIssuerUrl: ISSUER,
    });
    expect(parsed).toEqual({ userCode: "GRUB-MNBZ", publicClientId: "app_demo" });
  });
});

describe("createKeycloakDeviceLoginHandler", () => {
  it("parseInitiateLoginRedirect", () => {
    const handler = createKeycloakDeviceLoginHandler({
      issuerUrl: ISSUER,
      m2mClientId: "m2m_demo",
      m2mClientSecret: "secret",
      allowInsecureHttp: true,
    });
    const target = `${ISSUER}/device?user_code=GRUB-MNBZ&client_id=app_demo`;
    const params = new URLSearchParams({
      iss: ISSUER,
      target_link_uri: target,
    });
    const parsed = handler.parseInitiateLoginRedirect(params);
    expect(parsed.userCode).toBe("GRUB-MNBZ");
    expect(parsed.publicClientId).toBe("app_demo");
  });
});
