import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderProductionOnboardingPage } from "./page.ts";

describe("renderProductionOnboardingPage", () => {
  it("auto-switches the owner wallet to Celo mainnet with an add-chain fallback", () => {
    const html = renderProductionOnboardingPage("nonce");

    assert.match(html, /wallet_switchEthereumChain/);
    assert.match(html, /wallet_addEthereumChain/);
    assert.match(html, /ensureCeloWalletChain/);
    assert.match(html, /String\(await wallet\.request\(\{method:"eth_chainId"\}\)\)\.toLowerCase\(\)/);
    assert.match(html, /"0xa4ec"/);
    assert.match(html, /https:\/\/forno\.celo\.org/);
    assert.match(html, /https:\/\/celoscan\.io/);
  });
});
