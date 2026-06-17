/**
 * Maps @openmeter/sdk paths (self-hosted /api/v1|v2) to Konnect Metering & Billing v3 paths.
 * @see https://developer.konghq.com/api/konnect/metering-and-billing/v3/
 */

const CUSTOMER_SUBSCRIPTIONS_PATH_RE = /\/customers\/([^/]+)\/subscriptions$/;

function applyKonnectPlanFields(
  item: Record<string, unknown>,
  planIdRaw: unknown,
  planKeyRaw: unknown,
): void {
  if (typeof planIdRaw === "string" && planIdRaw.trim()) {
    const existingPlan =
      item.plan && typeof item.plan === "object"
        ? { ...(item.plan as Record<string, unknown>) }
        : {};
    if (!existingPlan.id && !existingPlan.key) {
      existingPlan.id = planIdRaw.trim();
    }
    item.plan = existingPlan;
  }

  if (typeof planKeyRaw === "string" && planKeyRaw.trim()) {
    const existingPlan =
      item.plan && typeof item.plan === "object"
        ? { ...(item.plan as Record<string, unknown>) }
        : {};
    if (!existingPlan.key) {
      existingPlan.key = planKeyRaw.trim();
    }
    item.plan = existingPlan;
  }
}

export function rewriteKonnectPathname(pathname: string, method: string): string {
  let path = pathname.replace(/\/api\/v[12](?=\/|$)/, "");

  path = path.replace(/\/billing\/profiles(?=\/|$)/, "/profiles");
  path = path.replace(/\/billing\/customers\/([^/]+)(?=\/|$)/, "/customers/$1/billing");

  const customerSubscriptions = CUSTOMER_SUBSCRIPTIONS_PATH_RE.exec(path);
  if (customerSubscriptions && method.toUpperCase() === "GET") {
    return path.replace(/\/customers\/[^/]+\/subscriptions$/, "/subscriptions");
  }

  return path;
}

export function rewriteKonnectSearchParams(
  pathname: string,
  method: string,
  searchParams: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(searchParams);

  const normalizedPath = pathname.replace(/\/api\/v[12](?=\/|$)/, "");
  const customerSubscriptions = CUSTOMER_SUBSCRIPTIONS_PATH_RE.exec(normalizedPath);
  if (customerSubscriptions && method.toUpperCase() === "GET") {
    params.set("filter[customer_id][eq]", decodeURIComponent(customerSubscriptions[1]));
  }

  if (params.has("key")) {
    const key = params.get("key") ?? "";
    params.delete("key");
    if (key.endsWith(":")) {
      params.set("filter[key][contains]", key);
    } else {
      params.set("filter[key][eq]", key);
    }
  }

  if (params.has("pageSize")) {
    const pageSize = params.get("pageSize");
    params.delete("pageSize");
    if (pageSize) {
      params.set("page[size]", pageSize);
    }
  }

  if (params.has("page")) {
    const page = params.get("page");
    params.delete("page");
    if (page) {
      params.set("page[number]", page);
    }
  }

  return params;
}

export function rewriteKonnectRequestUrl(url: URL, method: string): URL {
  const next = new URL(url.toString());
  const rewrittenPath = rewriteKonnectPathname(next.pathname, method);
  next.pathname = rewrittenPath;
  next.search = rewriteKonnectSearchParams(url.pathname, method, next.searchParams).toString();
  return next;
}

function rewriteKonnectSubscriptionCreateBody(body: unknown): unknown {
  if (typeof body !== "object" || body === null) {
    return body;
  }

  const record = body as Record<string, unknown>;
  if (record.customer != null) {
    return body;
  }

  const customer: Record<string, string> = {};
  if (typeof record.customerId === "string" && record.customerId.trim()) {
    customer.id = record.customerId.trim();
  }
  if (typeof record.customerKey === "string" && record.customerKey.trim()) {
    customer.key = record.customerKey.trim();
  }
  if (Object.keys(customer).length === 0) {
    return body;
  }

  const next: Record<string, unknown> = { ...record, customer };
  delete next.customerId;
  delete next.customerKey;
  return next;
}

export function rewriteKonnectRequestBody(
  pathname: string,
  method: string,
  body: unknown,
): unknown {
  const normalizedPath = rewriteKonnectPathname(pathname, method);
  const verb = method.toUpperCase();

  if (verb === "POST" && normalizedPath.endsWith("/subscriptions")) {
    return rewriteKonnectSubscriptionCreateBody(body);
  }

  return body;
}

export function normalizeKonnectSubscriptionRecord(record: unknown): unknown {
  if (!record || typeof record !== "object") {
    return record;
  }

  const item = { ...(record as Record<string, unknown>) };
  const planIdRaw = item.plan_id ?? item.planId;
  const planKeyRaw = item.plan_key ?? item.planKey;

  applyKonnectPlanFields(item, planIdRaw, planKeyRaw);

  delete item.plan_id;
  delete item.plan_key;
  return item;
}

export function normalizeKonnectListResponse(body: unknown): unknown {
  if (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Array.isArray((body as Record<string, unknown>).data) &&
    !("items" in body)
  ) {
    const data = ((body as Record<string, unknown>).data as unknown[]).map(
      normalizeKonnectSubscriptionRecord,
    );
    return { ...(body as Record<string, unknown>), items: data, data };
  }
  return body;
}

export function normalizeKonnectResponseBody(body: unknown): unknown {
  const listed = normalizeKonnectListResponse(body);
  if (
    listed &&
    typeof listed === "object" &&
    "id" in listed &&
    "status" in listed &&
    ("plan_id" in listed || "planId" in listed || "plan" in listed)
  ) {
    return normalizeKonnectSubscriptionRecord(listed);
  }
  return listed;
}
