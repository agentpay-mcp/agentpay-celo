import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCeloPaymentOption, parseAgentPayMcpPaymentEnv } from "./celo-agent-payment.ts";

describe("parseAgentPayMcpPaymentEnv", () => {
  it("leaves public MCP payments disabled by default", () => {
    assert.equal(parseAgentPayMcpPaymentEnv({}), undefined);
  });

  it("parses Celo x402 seller config with the hosted facilitator", () => {
    assert.deepEqual(
      parseAgentPayMcpPaymentEnv({
        AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
        AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
        AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.01",
        AGENTPAY_A2MCP_PAYMENT_NETWORK: "eip155:42220",
        AGENTPAY_A2MCP_PAYMENT_MAX_TIMEOUT_SECONDS: "120",
        AGENTPAY_A2MCP_PAYMENT_ASSET_DECIMALS: "6",
        AGENTPAY_A2MCP_PAYMENT_SYNC_SETTLE: "yes",
        AGENTPAY_CELO_X402_API_KEY: "test-celo-x402-api-key",
      }),
      {
        enabled: true,
        payTo: "0x0000000000000000000000000000000000000002",
        price: "$0.01",
        network: "eip155:42220",
        asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        maxTimeoutSeconds: 120,
        assetDecimals: 6,
        facilitatorUrl: "https://api.x402.celo.org",
        facilitatorApiKey: "test-celo-x402-api-key",
        syncSettle: true,
        assetTransferMethod: "eip3009",
      },
    );
  });

  it("keeps ERC-8021 app attribution out of facilitator settlement configuration", () => {
    const config = parseAgentPayMcpPaymentEnv({
      AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
      AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
      AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.01",
      AGENTPAY_CELO_X402_API_KEY: "test-celo-x402-api-key",
      CELO_ATTRIBUTION_TAG: "celo_agentpay",
    });

    assert.ok(config);
    assert.equal("celoAttributionTag" in config, false);
    assert.equal("mirrorTransaction" in config, false);
  });

  it("reports invalid config names without echoing secret values", () => {
    assert.throws(
      () =>
        parseAgentPayMcpPaymentEnv({
          AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
          AGENTPAY_A2MCP_PAYMENT_PAY_TO: "not-an-address",
          AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.01",
          AGENTPAY_CELO_X402_API_KEY: "test-celo-x402-secret-value",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /AGENTPAY_A2MCP_PAYMENT_PAY_TO/);
        assert.doesNotMatch(error.message, /dummy-secret-value/);
        return true;
      },
    );
  });

  it("rejects unknown boolean values instead of silently disabling payment or sync settlement", () => {
    assert.throws(
      () => parseAgentPayMcpPaymentEnv({ AGENTPAY_A2MCP_PAYMENT_ENABLED: "treu" }),
      /AGENTPAY_A2MCP_PAYMENT_ENABLED/i,
    );
    assert.throws(
      () =>
        parseAgentPayMcpPaymentEnv({
          AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
          AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
          AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.01",
          AGENTPAY_A2MCP_PAYMENT_SYNC_SETTLE: "tru",
          AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL: "https://facilitator.example.com",
        }),
      /AGENTPAY_A2MCP_PAYMENT_SYNC_SETTLE/i,
    );
  });

  it("pins Celo mainnet x402 to canonical USDC", () => {
    assert.throws(
      () =>
        parseAgentPayMcpPaymentEnv({
          AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
          AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
          AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.01",
          AGENTPAY_A2MCP_PAYMENT_ASSET: "0x0000000000000000000000000000000000000003",
          AGENTPAY_CELO_X402_API_KEY: "test-celo-x402-api-key",
        }),
      /AGENTPAY_A2MCP_PAYMENT_ASSET/i,
    );
  });

  it("uses the Celo Sepolia facilitator and canonical test USDC", () => {
    assert.deepEqual(
      parseAgentPayMcpPaymentEnv({
        AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
        AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
        AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.01",
        AGENTPAY_A2MCP_PAYMENT_NETWORK: "eip155:11142220",
        AGENTPAY_CELO_X402_API_KEY: "x402_test_dummy-api-key",
      }),
      {
        enabled: true,
        payTo: "0x0000000000000000000000000000000000000002",
        price: "$0.01",
        network: "eip155:11142220",
        asset: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
        maxTimeoutSeconds: 300,
        assetDecimals: 6,
        facilitatorUrl: "https://api.x402.sepolia.celo.org",
        facilitatorApiKey: "x402_test_dummy-api-key",
        assetTransferMethod: "eip3009",
      },
    );
  });

  it("converts arbitrary dollar-denominated USDC prices to atomic units", () => {
    const config = parseAgentPayMcpPaymentEnv({
      AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
      AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
      AGENTPAY_A2MCP_PAYMENT_PRICE: "$0.02",
      AGENTPAY_CELO_X402_API_KEY: "test-celo-x402-api-key",
    });

    assert.ok(config);
    assert.deepEqual(createCeloPaymentOption(config).price, {
      amount: "20000",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      extra: {
        name: "USDC",
        version: "2",
      },
    });
  });

  it("rejects non-positive, over-precision, and non-USDC decimal seller pricing", () => {
    for (const price of ["$0", "$0.0000001", "0.02"]) {
      assert.throws(
        () => parseAgentPayMcpPaymentEnv({
          AGENTPAY_A2MCP_PAYMENT_ENABLED: "true",
          AGENTPAY_A2MCP_PAYMENT_PAY_TO: "0x0000000000000000000000000000000000000002",
          AGENTPAY_A2MCP_PAYMENT_PRICE: price,
          AGENTPAY_CELO_X402_API_KEY: "test-celo-x402-api-key",
        }),
        /AGENTPAY_A2MCP_PAYMENT_PRICE/i,
      );
    }
  });
});
