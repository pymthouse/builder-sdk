function isAsciiWhitespace(code: number): boolean {
  return code <= 32;
}

function bearerTokenStart(header: string): number {
  const prefix = "bearer";
  if (header.length < prefix.length) {
    return -1;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (((header.codePointAt(i) ?? 0) | 32) !== prefix.codePointAt(i)!) {
      return -1;
    }
  }
  let start = prefix.length;
  while (start < header.length && isAsciiWhitespace(header.codePointAt(start) ?? 0)) {
    start++;
  }
  return start < header.length ? start : -1;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  if (!header) {
    return null;
  }
  const start = bearerTokenStart(header);
  if (start < 0) {
    return null;
  }
  let end = header.length;
  while (end > start && isAsciiWhitespace(header.codePointAt(end - 1) ?? 0)) {
    end--;
  }
  return header.slice(start, end);
}

export function unauthorizedResponse(message = "unauthorized"): Response {
  return Response.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = "forbidden"): Response {
  return Response.json({ error: message }, { status: 403 });
}

export function disabledResponse(): Response {
  return Response.json(
    {
      error: "gateway_disabled",
      error_description: "Set GATEWAY_ENABLED=1 to enable the browser gateway relay",
    },
    { status: 503 },
  );
}
