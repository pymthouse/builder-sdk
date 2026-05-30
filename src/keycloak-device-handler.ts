import { PmtHouseClient } from "./client.js";
import {
  extractDeviceApprovalFromKeycloakTargetLink,
  validateDeviceInitiateLoginForKeycloak,
} from "./device-initiate.js";
import type { TokenExchangeResponse } from "./types.js";

export type KeycloakDeviceLoginHandlerOptions = {
  issuerUrl: string;
  m2mClientId: string;
  m2mClientSecret: string;
  allowInsecureHttp?: boolean;
};

export type ParsedKeycloakDeviceInitiate = {
  userCode: string;
  publicClientId: string;
  returnUrl: string;
  issuer: string;
};

export function createKeycloakDeviceLoginHandler(
  options: KeycloakDeviceLoginHandlerOptions,
) {
  const client = new PmtHouseClient({
    issuerUrl: options.issuerUrl,
    publicClientId: "",
    m2mClientId: options.m2mClientId,
    m2mClientSecret: options.m2mClientSecret,
    allowInsecureHttp: options.allowInsecureHttp,
  });

  return {
    validateInitiateLogin(iss: string, targetLinkUri: string) {
      return validateDeviceInitiateLoginForKeycloak({
        expectedIssuerUrl: options.issuerUrl,
        iss,
        targetLinkUri,
      });
    },

    parseInitiateLoginRedirect(searchParams: URLSearchParams): ParsedKeycloakDeviceInitiate {
      const issuer = searchParams.get("iss")?.trim() ?? "";
      const targetLinkUri = searchParams.get("target_link_uri")?.trim() ?? "";
      const validation = validateDeviceInitiateLoginForKeycloak({
        expectedIssuerUrl: options.issuerUrl,
        iss: issuer,
        targetLinkUri,
      });
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const parsed = extractDeviceApprovalFromKeycloakTargetLink(targetLinkUri, {
        expectedIssuerUrl: options.issuerUrl,
      });
      if ("error" in parsed) {
        throw new Error(parsed.error);
      }
      return {
        issuer,
        returnUrl: validation.returnUrl,
        userCode: parsed.userCode,
        publicClientId: parsed.publicClientId,
      };
    },

    async completeDeviceApproval(input: {
      userCode: string;
      userJwt: string;
      publicClientId: string;
    }): Promise<TokenExchangeResponse> {
      void input.publicClientId;
      return client.completeDeviceApproval({
        userCode: input.userCode,
        userJwt: input.userJwt,
      });
    },
  };
}
