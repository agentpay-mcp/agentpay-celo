import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { getNativeCurrency, networkSelectionShape } from "./chains.ts";

describe("getNativeCurrency", () => {
  it("returns native currency metadata for supported chains", () => {
    assert.deepEqual(getNativeCurrency(196), {
      symbol: "OKB",
      decimals: 18,
    });
    assert.deepEqual(getNativeCurrency(1952), {
      symbol: "OKB",
      decimals: 18,
    });
    assert.deepEqual(getNativeCurrency(42220), {
      symbol: "CELO",
      decimals: 18,
    });
    assert.deepEqual(getNativeCurrency(11142220), {
      symbol: "CELO",
      decimals: 18,
    });
  });

  it("throws for unsupported chains", () => {
    assert.throws(() => getNativeCurrency(1), /Unsupported chain 1/);
  });

  it("accepts only Celo network selectors for AgentPay Celo inputs", () => {
    const schema = z.object(networkSelectionShape);

    assert.deepEqual(schema.parse({ network: "mainnet", homeChainId: 42220 }), {
      network: "mainnet",
      homeChainId: 42220,
    });
    assert.deepEqual(schema.parse({ network: "testnet", homeChainId: 11142220 }), {
      network: "testnet",
      homeChainId: 11142220,
    });
    assert.throws(() => schema.parse({ homeChainId: 196 }));
    assert.throws(() => schema.parse({ homeChainId: 1952 }));
  });
});
