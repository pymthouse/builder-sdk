/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  aggregateUsageByExternalUserId,
  buildMeScopeUsagePayload,
  getEndUserIdsForExternalUser,
  getUtcCalendarMonthIsoBounds,
  listUsageByPipelineModel,
  parseUsageDateParam,
  summarizeUsageForExternalUser,
} from "../src/usage.js";
import type { UsageApiResponse, UsageByUserRow } from "../src/types.js";

describe("usage aggregation", () => {
  it("returns zeros when byUser is missing or empty", () => {
    expect(aggregateUsageByExternalUserId(undefined, "u1")).toEqual({
      externalUserId: "u1",
      requestCount: 0,
      feeWei: "0",
    });
    expect(aggregateUsageByExternalUserId([], "u1")).toEqual({
      externalUserId: "u1",
      requestCount: 0,
      feeWei: "0",
    });
  });

  it("returns values from a single matching row", () => {
    const byUser: UsageByUserRow[] = [
      { endUserId: "a", externalUserId: "x", requestCount: 1, feeWei: "1" },
      { endUserId: "b", externalUserId: "y", requestCount: 2, feeWei: "2" },
    ];
    expect(aggregateUsageByExternalUserId(byUser, "y")).toEqual({
      externalUserId: "y",
      requestCount: 2,
      feeWei: "2",
    });
  });

  it("matches owner: / bare id variants for the same subject", () => {
    const byUser: UsageByUserRow[] = [
      {
        endUserId: "uuid-1",
        externalUserId: "uuid-1",
        requestCount: 5,
        feeWei: "5",
        networkFeeUsdMicros: "500",
      },
    ];
    expect(aggregateUsageByExternalUserId(byUser, "owner:uuid-1").requestCount).toBe(5);
    expect(aggregateUsageByExternalUserId(byUser, "user:uuid-1").requestCount).toBe(5);
  });

  it("sums requestCount and feeWei across duplicate externalUserId buckets", () => {
    const byUser: UsageByUserRow[] = [
      { endUserId: "app-user-id", externalUserId: "naap-user-id", requestCount: 19, feeWei: "1123447749974" },
      { endUserId: "end-user-id", externalUserId: "naap-user-id", requestCount: 43, feeWei: "2540996510612" },
      { endUserId: "naap-user-id", externalUserId: "naap-user-id", requestCount: 10, feeWei: "591680839970" },
    ];
    expect(aggregateUsageByExternalUserId(byUser, "naap-user-id")).toEqual({
      externalUserId: "naap-user-id",
      requestCount: 72,
      feeWei: "4256125100556",
    });
  });

  it("ignores null externalUserId and non-matching rows", () => {
    const byUser: UsageByUserRow[] = [
      { endUserId: "a", externalUserId: null, requestCount: 99, feeWei: "99" },
      { endUserId: "b", externalUserId: "other", requestCount: 1, feeWei: "1" },
    ];
    expect(aggregateUsageByExternalUserId(byUser, "target")).toEqual({
      externalUserId: "target",
      requestCount: 0,
      feeWei: "0",
    });
  });

  it("summarizeUsageForExternalUser delegates to byUser", () => {
    const usage: UsageApiResponse = {
      clientId: "c",
      period: { start: null, end: null },
      totals: { requestCount: 0, totalFeeWei: "0" },
      byUser: [{ endUserId: "e", externalUserId: "u", requestCount: 3, feeWei: "5" }],
    };
    expect(summarizeUsageForExternalUser(usage, "u")).toEqual({
      externalUserId: "u",
      requestCount: 3,
      feeWei: "5",
    });
  });

  it("listUsageByPipelineModel returns empty array when missing", () => {
    const usage: UsageApiResponse = {
      clientId: "c",
      period: { start: null, end: null },
      totals: { requestCount: 0, totalFeeWei: "0" },
    };
    expect(listUsageByPipelineModel(usage)).toEqual([]);
  });

  it("listUsageByPipelineModel sorts by pipeline then modelId", () => {
    const usage: UsageApiResponse = {
      clientId: "c",
      period: { start: null, end: null },
      totals: { requestCount: 0, totalFeeWei: "0" },
      byPipelineModel: [
        {
          pipeline: "b-pipe",
          modelId: "m1",
          requestCount: 1,
          networkFeeWei: "1",
          networkFeeUsdMicros: "0",
          ownerChargeUsdMicros: "0",
          endUserBillableUsdMicros: "0",
        },
        {
          pipeline: "a-pipe",
          modelId: "m2",
          requestCount: 2,
          networkFeeWei: "2",
          networkFeeUsdMicros: "0",
          ownerChargeUsdMicros: "0",
          endUserBillableUsdMicros: "0",
        },
        {
          pipeline: "a-pipe",
          modelId: "m1",
          requestCount: 3,
          networkFeeWei: "3",
          networkFeeUsdMicros: "0",
          ownerChargeUsdMicros: "0",
          endUserBillableUsdMicros: "0",
        },
      ],
    };
    expect(listUsageByPipelineModel(usage).map((r) => `${r.pipeline}:${r.modelId}`)).toEqual([
      "a-pipe:m1",
      "a-pipe:m2",
      "b-pipe:m1",
    ]);
  });

  it("parseUsageDateParam accepts ISO and rejects junk", () => {
    expect(parseUsageDateParam("2025-04-01T00:00:00.000Z")).toBe("2025-04-01T00:00:00.000Z");
    expect(parseUsageDateParam("not-a-date")).toBeNull();
  });

  it("buildMeScopeUsagePayload aggregates fiat fields for external user", () => {
    const body = buildMeScopeUsagePayload(
      {
        clientId: "app",
        period: { start: null, end: null },
        totals: { requestCount: 0 },
        byUser: [
          {
            endUserId: "a",
            externalUserId: "naap-user-id",
            requestCount: 19,
            networkFeeUsdMicros: "1900000",
            ownerChargeUsdMicros: "2000000",
            endUserBillableUsdMicros: "2100000",
            currency: "USD",
          },
          {
            endUserId: "b",
            externalUserId: "naap-user-id",
            requestCount: 43,
            networkFeeUsdMicros: "4300000",
            ownerChargeUsdMicros: "4400000",
            endUserBillableUsdMicros: "4500000",
            currency: "USD",
          },
        ],
      },
      "naap-user-id",
    );
    expect(body.currentUser.requestCount).toBe(62);
    expect(body.currentUser.networkFeeUsdMicros).toBe("6200000");
  });

  it("getEndUserIdsForExternalUser skips unknown endUserId", () => {
    expect(
      getEndUserIdsForExternalUser(
        {
          clientId: "app",
          period: { start: null, end: null },
          totals: { requestCount: 0 },
          byUser: [
            { endUserId: "app-user-id", externalUserId: "me", requestCount: 1 },
            { endUserId: "unknown", externalUserId: "me", requestCount: 4 },
          ],
        },
        "me",
      ),
    ).toEqual(["app-user-id"]);
  });

  it("getUtcCalendarMonthIsoBounds returns ordered ISO strings", () => {
    const fixed = new Date(Date.UTC(2026, 3, 15, 12, 0, 0));
    const { startDate, endDate } = getUtcCalendarMonthIsoBounds(fixed);
    expect(startDate < endDate).toBe(true);
    expect(startDate.startsWith("2026-04-01")).toBe(true);
  });
});
