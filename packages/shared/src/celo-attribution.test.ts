import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromDataSuffix } from "@celo/attribution-tags";

import {
  appendCeloAttributionTag,
  assertAssignedCeloAttributionTag,
} from "./celo-attribution.ts";

describe("Celo ERC-8021 attribution", () => {
  it("appends the assigned tag to calldata and decodes it from the final suffix", () => {
    const tagged = appendCeloAttributionTag("0x1234", "celo_agentpay");

    assert.equal(tagged.startsWith("0x1234"), true);
    assert.deepEqual(fromDataSuffix(tagged), {
      codes: ["celo_agentpay"],
      schemaId: 0,
    });
  });

  it("keeps empty calldata valid by returning a tag-only data payload", () => {
    const tagged = appendCeloAttributionTag("0x", "celo_agentpay");

    assert.deepEqual(fromDataSuffix(tagged), {
      codes: ["celo_agentpay"],
      schemaId: 0,
    });
  });

  it("rejects malformed assigned tags and malformed calldata", () => {
    for (const tag of [
      "",
      "agentpay",
      "celo_",
      "Celo_agentpay",
      "celo_agent-pay",
      `celo_${"a".repeat(28)}`,
    ]) {
      assert.throws(() => assertAssignedCeloAttributionTag(tag), /Celo attribution tag/i);
    }

    assert.throws(() => appendCeloAttributionTag("1234", "celo_agentpay"), /calldata/i);
    assert.throws(() => appendCeloAttributionTag("0x123", "celo_agentpay"), /calldata/i);
  });

  it("rejects accidental double tagging instead of nesting another suffix", () => {
    const tagged = appendCeloAttributionTag("0x1234", "celo_agentpay");

    assert.throws(
      () => appendCeloAttributionTag(tagged, "celo_agentpay"),
      /already contains an ERC-8021 attribution suffix/i,
    );
  });
});
