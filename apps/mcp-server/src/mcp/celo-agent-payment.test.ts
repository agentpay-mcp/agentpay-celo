import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  type HTTPRequestContext,
} from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";

import {
  createCeloAgentPaymentProcessor,
  createCeloExpectedPaymentTerms,
  createCeloPaymentOption,
  parseAgentPayMcpPaymentEnv,
} from "./celo-agent-payment.ts";

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
    assert.deepEqual(createCeloExpectedPaymentTerms(config), {
      scheme: "exact",
      network: "eip155:42220",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      amount: "20000",
      payTo: "0x0000000000000000000000000000000000000002",
      maxTimeoutSeconds: 300,
      assetTransferMethod: "eip3009",
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

  it("uses the configured facilitator for supported, verify, and settle", async () => {
    const payer = "0x0000000000000000000000000000000000000003";
    const transaction = `0x${"44".repeat(32)}`;
    const calls: Array<{ path: string; method: string; apiKey?: string; body?: unknown }> = [];
    const facilitator = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks).toString("utf8");
      calls.push({
        path: request.url ?? "",
        method: request.method ?? "",
        ...(typeof request.headers["x-api-key"] === "string"
          ? { apiKey: request.headers["x-api-key"] }
          : {}),
        ...(rawBody ? { body: JSON.parse(rawBody) as unknown } : {}),
      });

      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/supported") {
        response.end(JSON.stringify({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }],
          extensions: [],
          signers: {},
        }));
        return;
      }
      if (request.url === "/verify") {
        response.end(JSON.stringify({ isValid: true, payer }));
        return;
      }
      response.end(JSON.stringify({ success: true, payer, transaction, network: "eip155:42220" }));
    });
    await new Promise<void>((resolve, reject) => {
      facilitator.once("error", reject);
      facilitator.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = facilitator.address() as AddressInfo;
      const config = {
        enabled: true,
        payTo: "0x0000000000000000000000000000000000000002",
        price: "$0.02",
        network: "eip155:42220" as const,
        asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        maxTimeoutSeconds: 300,
        facilitatorUrl: `http://127.0.0.1:${address.port}`,
        facilitatorApiKey: "test-facilitator-key",
        syncSettle: true,
        assetTransferMethod: "eip3009" as const,
        assetDecimals: 6,
      };
      const processor = await createCeloAgentPaymentProcessor(config, { mcpPath: "/celo/mcp" });
      const challenge = await processor.processHTTPRequest(createRequestContext());
      if (challenge.type !== "payment-error") throw new Error("Expected the seller to issue a payment challenge.");
      const challengeHeader = Object.entries(challenge.response.headers)
        .find(([name]) => name.toLowerCase() === "payment-required")?.[1];
      assert.ok(challengeHeader);
      const requirements = decodePaymentRequiredHeader(challengeHeader).accepts[0]!;
      const paymentPayload: PaymentPayload = {
        x402Version: 2,
        accepted: requirements,
        payload: {
          authorization: { from: payer },
          signature: `0x${"11".repeat(65)}`,
        },
      };
      const verified = await processor.processHTTPRequest(
        createRequestContext(encodePaymentSignatureHeader(paymentPayload)),
      );
      if (verified.type !== "payment-verified") throw new Error("Expected the facilitator to verify the payment.");
      const settled = await processor.processSettlement(
        verified.paymentPayload,
        verified.paymentRequirements,
        verified.declaredExtensions,
      );

      assert.equal(settled.success, true);
      assert.equal(settled.transaction, transaction);
      assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
        "GET /supported",
        "POST /verify",
        "POST /settle",
      ]);
      assert.deepEqual(calls.map((call) => call.apiKey), [
        "test-facilitator-key",
        "test-facilitator-key",
        "test-facilitator-key",
      ]);
      assert.deepEqual(processor.expectedPaymentRequirements, createCeloExpectedPaymentTerms(config));
    } finally {
      await new Promise<void>((resolve, reject) => {
        facilitator.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

function createRequestContext(paymentHeader?: string): HTTPRequestContext {
  return {
    method: "POST",
    path: "/celo/mcp",
    ...(paymentHeader ? { paymentHeader } : {}),
    adapter: {
      getHeader(name) {
        return name.toLowerCase() === "payment-signature" ? paymentHeader : undefined;
      },
      getMethod: () => "POST",
      getPath: () => "/celo/mcp",
      getUrl: () => "https://mcp.agentpay.site/celo/mcp",
      getAcceptHeader: () => "application/json",
      getUserAgent: () => "agentpay-integration-test",
    },
  };
}
