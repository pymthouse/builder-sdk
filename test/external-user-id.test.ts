/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  ExternalUserIdError,
  INVALID_EXTERNAL_USER_ID,
  isValidExternalUserId,
  parseExternalUserId,
} from "../src/external-user-id.js";

describe("parseExternalUserId", () => {
  it("accepts UUID and slug-like machine ids", () => {
    expect(
      parseExternalUserId("5a5d8e06-d6ab-41f3-b557-7b4e15789b1a"),
    ).toBe("5a5d8e06-d6ab-41f3-b557-7b4e15789b1a");
    expect(parseExternalUserId("user-naap-1")).toBe("user-naap-1");
  });

  it("rejects email-shaped ids", () => {
    expect(() => parseExternalUserId("a@b.co")).toThrow(ExternalUserIdError);
    expect(isValidExternalUserId("demo@livepeer.org")).toBe(false);
  });

  it("rejects owner: and user: wire prefixes", () => {
    expect(() => parseExternalUserId("owner:uuid-1")).toThrow(ExternalUserIdError);
    try {
      parseExternalUserId("user:uuid-1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalUserIdError);
      expect((err as ExternalUserIdError).code).toBe(INVALID_EXTERNAL_USER_ID);
    }
  });
});
