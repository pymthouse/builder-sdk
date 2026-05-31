import { PmtHouseError } from "../errors.js";

export type ReadJsonObjectFromResponseOptions = {
  invalidJsonMessage: string;
  invalidJsonCode: string;
  failureLabel: string;
  defaultErrorCode: string;
};

export async function readJsonObjectFromResponse(
  response: Response,
  options: ReadJsonObjectFromResponseOptions,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new PmtHouseError(options.invalidJsonMessage, {
      status: 502,
      code: options.invalidJsonCode,
      details: { status: response.status },
    });
  }

  if (!response.ok) {
    const description =
      typeof parsed.error_description === "string"
        ? parsed.error_description
        : typeof parsed.error === "string"
          ? parsed.error
          : `${options.failureLabel} (${response.status})`;
    throw new PmtHouseError(description, {
      status: response.status,
      code: typeof parsed.error === "string" ? parsed.error : options.defaultErrorCode,
      details: parsed,
    });
  }

  return parsed;
}
