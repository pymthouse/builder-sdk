/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  aggregateUsageByExternalUserId,
  listUsageByPipelineModel,
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
});
