/**
 * Base64url-safe Basic auth encoding for `client_id:client_secret` (UTF-8).
 * Works in Node, Edge, and Workers without assuming `Buffer`.
 */
export function encodeClientSecretBasic(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  const b64 =
    typeof Buffer === "undefined"
      ? btoa(Array.from(new TextEncoder().encode(raw), (c) => String.fromCodePoint(c)).join(""))
      : Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}
