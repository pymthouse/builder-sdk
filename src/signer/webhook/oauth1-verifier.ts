import type { UsageIdentity } from "./types.js";
import type { EndUserAuthVerifier } from "./verifier.js";

export type OAuth1EndUserAuthConfig = {
  consumerKey: string;
  consumerSecret: string;
  /** Resolve oauth_token → UsageIdentity (platform-owned store). */
  resolveIdentity: (oauthToken: string) => Promise<UsageIdentity>;
  tokenSecretLookup?: (oauthToken: string) => Promise<string | undefined>;
};

/**
 * OAuth 1.0a end-user auth verifier (stub).
 *
 * A full implementation will parse `Authorization: OAuth …` from
 * `context.authorization`, validate the signature using `context.payload.headers`
 * and the request URL, then call `resolveIdentity`.
 */
export function createOAuth1EndUserVerifier(
  config: OAuth1EndUserAuthConfig,
): EndUserAuthVerifier {
  void config;
  return {
    kind: "oauth1",
    verify: async () => {
      throw new Error("OAuth 1.0 webhook verification is not implemented yet");
    },
  };
}
