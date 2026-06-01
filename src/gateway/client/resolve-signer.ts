import { exchangeApiKeyForSigner } from "../../signer/api-key-exchange.js";

export type SignerCredentials =
  | { type: "bearer"; accessToken: string }
  | { type: "apiKey"; apiKey: string; facadeUrl: string; scope?: string; clientId?: string };

const boundFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export async function resolveSignerToken(
  credentials: SignerCredentials,
  fetchImpl: typeof fetch = boundFetch,
): Promise<string> {
  if (credentials.type === "bearer") {
    const token = credentials.accessToken.trim();
    if (!token) {
      throw new Error("Signer bearer token is empty");
    }
    return token;
  }

  const exchanged = await exchangeApiKeyForSigner({
    facadeUrl: credentials.facadeUrl,
    apiKey: credentials.apiKey,
    scope: credentials.scope ?? "sign:job",
    clientId: credentials.clientId,
    fetch: fetchImpl,
  });

  const token =
    exchanged.access_token?.trim() ||
    exchanged.token?.accessToken?.trim() ||
    exchanged.token?.access_token?.trim();
  if (!token) {
    throw new Error("API key exchange did not return a signer access token");
  }
  return token;
}
