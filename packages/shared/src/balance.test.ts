import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getBalanceInputSchema } from "./balance.ts";

describe("getBalanceInputSchema", () => {
  it("defaults to Celo USDC, USDT, and USDm balances", () => {
    assert.deepEqual(getBalanceInputSchema.parse({}), {
      tokenSymbols: ["USDC", "USDT", "USDm"],
    });
  });

  it("accepts an explicit stablecoin subset", () => {
    assert.deepEqual(getBalanceInputSchema.parse({ tokenSymbols: ["USDC"] }), {
      tokenSymbols: ["USDC"],
    });
  });

  it("rejects tokens that are unavailable on Celo", () => {
    assert.throws(() => getBalanceInputSchema.parse({ tokenSymbols: ["USDT0"] }));
  });
});
