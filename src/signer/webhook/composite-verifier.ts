import { PmtHouseError } from "../../errors.js";
import type { EndUserAuthVerifier } from "./verifier.js";

export function createFirstMatchEndUserVerifier(
  verifiers: EndUserAuthVerifier[],
): EndUserAuthVerifier {
  if (verifiers.length === 0) {
    throw new PmtHouseError("at least one verifier is required", {
      status: 500,
      code: "invalid_verifier_config",
    });
  }

  return {
    kind: "custom",
    verify: async (context) => {
      let lastError: unknown;
      for (const verifier of verifiers) {
        try {
          return await verifier.verify(context);
        } catch (err) {
          lastError = err;
        }
      }

      if (lastError instanceof PmtHouseError) {
        throw lastError;
      }
      if (lastError instanceof Error) {
        throw new PmtHouseError(lastError.message, {
          status: 401,
          code: "invalid_credentials",
        });
      }
      throw new PmtHouseError("invalid credentials", {
        status: 401,
        code: "invalid_credentials",
      });
    },
    adminRoutes: verifiers.flatMap((verifier) => verifier.adminRoutes ?? []),
  };
}
