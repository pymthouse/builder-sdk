/** Resolve fetch() input to a URL string for test assertions. */
export function resolveFetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (input instanceof Request) {
    return input.url;
  }
  throw new TypeError("Unexpected fetch input type");
}
