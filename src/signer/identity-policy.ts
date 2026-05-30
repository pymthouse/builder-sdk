import type { JWTAccessTokenClaims } from "oauth4webapi";
import { verifyJwt, type VerifyJwtOptions } from "../verify.js";
import { PmtHouseError } from "../errors.js";
import { normalizeSignerIdentity, signerIdentityEquals } from "./identity.js";
import type { SignerIdentity, SignerUsageSubjectType } from "./types.js";

export interface SignerIdentityResolver {
  resolveFromSubjectToken(
    subjectToken: string,
    hints?: SignerIdentityHints,
  ): Promise<SignerIdentity>;
  resolveFromBearerToken(bearerToken: string): Promise<SignerIdentity>;
}

export interface SignerIdentityHints {
  clientId?: string;
}

export interface CreateJwtClaimsIdentityResolverOptions extends VerifyJwtOptions {
  /** Claim used when `usage_subject` is absent. Defaults to `sub`. */
  usageSubjectClaim?: "sub" | "usage_subject";
  defaultUsageSubjectType?: SignerUsageSubjectType;
}

function claimString(claims: JWTAccessTokenClaims, key: string): string | undefined {
  const value = (claims as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function identityFromAccessTokenClaims(
  claims: JWTAccessTokenClaims,
  options: Pick<
    CreateJwtClaimsIdentityResolverOptions,
    "issuerUrl" | "usageSubjectClaim" | "defaultUsageSubjectType"
  >,
): SignerIdentity {
  const issuer = claimString(claims, "iss") ?? options.issuerUrl;
  const clientId = claimString(claims, "client_id") ?? claimString(claims, "azp");
  const usageSubject =
    claimString(claims, "usage_subject") ??
    (options.usageSubjectClaim === "usage_subject"
      ? undefined
      : claimString(claims, "sub"));
  const usageSubjectType =
    (claimString(claims, "usage_subject_type") as SignerUsageSubjectType | undefined) ??
    options.defaultUsageSubjectType ??
    "external_user_id";

  return normalizeSignerIdentity({
    issuer,
    client_id: clientId,
    usage_subject: usageSubject,
    usage_subject_type: usageSubjectType,
  });
}

export function createJwtClaimsIdentityResolver(
  options: CreateJwtClaimsIdentityResolverOptions,
): SignerIdentityResolver {
  async function resolveClaims(
    token: string,
    hints?: SignerIdentityHints,
  ): Promise<SignerIdentity> {
    const claims = await verifyJwt(token, options);
    const identity = identityFromAccessTokenClaims(claims, options);

    if (hints?.clientId && hints.clientId !== identity.clientId) {
      throw new PmtHouseError("clientId does not match subject token", {
        status: 403,
        code: "identity_mismatch",
      });
    }

    return identity;
  }

  return {
    resolveFromSubjectToken: resolveClaims,
    resolveFromBearerToken: resolveClaims,
  };
}

export function assertIdentityMatches(
  expected: SignerIdentity,
  actual: SignerIdentity,
  message = "identity mismatch",
): void {
  if (!signerIdentityEquals(expected, actual)) {
    throw new PmtHouseError(message, {
      status: 403,
      code: "identity_mismatch",
    });
  }
}
