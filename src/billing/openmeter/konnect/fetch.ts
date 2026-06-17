import {
  normalizeKonnectResponseBody,
  rewriteKonnectRequestBody,
  rewriteKonnectRequestUrl,
} from "./routes.js";

async function buildKonnectRequest(request: Request): Promise<Request> {
  const sourceUrl = new URL(request.url);
  const rewritten = rewriteKonnectRequestUrl(sourceUrl, request.method);

  const contentType = request.headers.get("content-type") ?? "";
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    contentType.includes("application/json")
  ) {
    const reqClone = request.clone();
    try {
      const json = await request.json();
      const body = rewriteKonnectRequestBody(rewritten.pathname, request.method, json);
      return new Request(rewritten.toString(), {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
        redirect: request.redirect,
        signal: request.signal,
        credentials: request.credentials,
        integrity: request.integrity,
        keepalive: request.keepalive,
        mode: request.mode,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
      });
    } catch {
      return new Request(rewritten.toString(), reqClone);
    }
  }

  return new Request(rewritten.toString(), request);
}

/**
 * Custom fetch for @openmeter/sdk when routing to Kong Konnect Metering & Billing v3.
 */
export function createKonnectFetch(allowedBaseUrl: string): typeof fetch {
  const allowedOrigin = new URL(allowedBaseUrl).origin;
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const konnectRequest = await buildKonnectRequest(request);

    const requested = new URL(konnectRequest.url);
    if (requested.origin !== allowedOrigin) {
      throw new Error("OpenMeter Konnect fetch blocked: unexpected origin");
    }
    const url = new URL(`${requested.pathname}${requested.search}`, allowedOrigin);

    const hasBody = konnectRequest.method !== "GET" && konnectRequest.method !== "HEAD";
    const response = await fetch(url, {
      method: konnectRequest.method,
      headers: konnectRequest.headers,
      body: hasBody ? await konnectRequest.arrayBuffer() : undefined,
      redirect: konnectRequest.redirect,
      signal: konnectRequest.signal,
      keepalive: konnectRequest.keepalive,
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return response;
    }
    const body = await response.json();
    const normalized = normalizeKonnectResponseBody(body);
    if (normalized === body) {
      return new Response(JSON.stringify(body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return new Response(JSON.stringify(normalized), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
