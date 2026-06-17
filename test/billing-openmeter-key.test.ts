import { describe, expect, it } from "vitest";
import {
  buildOpenMeterCustomerKey,
  parseOpenMeterCustomerKey,
} from "../src/billing/openmeter/customer-key.js";

describe("buildOpenMeterCustomerKey", () => {
  it("joins client and external user", () => {
    expect(buildOpenMeterCustomerKey("app_1", "auth0|user")).toBe("app_1:auth0|user");
  });

  it("parses customer key", () => {
    expect(parseOpenMeterCustomerKey("app_1:auth0|user")).toEqual({
      clientId: "app_1",
      externalUserId: "auth0|user",
    });
  });
});
