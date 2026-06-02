function bearerTokenStart(header: string): number {
  const prefix = "bearer";
  if (header.length < prefix.length) {
    return -1;
  }
  for (let i = 0; i < prefix.length; i++) {
    if ((header.charCodeAt(i) | 32) !== prefix.charCodeAt(i)) {
      return -1;
    }
  }
  let start = prefix.length;
  while (start < header.length && header.charCodeAt(start) <= 32) {
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
  while (end > start && header.charCodeAt(end - 1) <= 32) {
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
