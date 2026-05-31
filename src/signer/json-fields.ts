import { PmtHouseError } from "../errors.js";

export function readStringField(
  body: Record<string, unknown>,
  key: string,
  errorCode: string,
  messagePrefix = "Response",
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new PmtHouseError(`${messagePrefix} missing ${key}`, {
      status: 502,
      code: errorCode,
    });
  }
  return value.trim();
}

export function readExpiresIn(body: Record<string, unknown>, errorCode: string): number {
  const expiresIn = body.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new PmtHouseError("Response missing expires_in", {
      status: 502,
      code: errorCode,
    });
  }
  return Math.floor(expiresIn);
}
