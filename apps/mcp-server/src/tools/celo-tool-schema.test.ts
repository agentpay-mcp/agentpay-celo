import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareAccountAdminTransactionTool } from "./account-admin.ts";
import { getBalanceTool } from "./get-balance.ts";
import { parseInvoicePaymentTool } from "./invoice.ts";
import { prepareContractCallTool } from "./prepare-contract-call.ts";
import { preparePaymentTool } from "./prepare-payment.ts";
import { quotePaymentRouteTool } from "./quote-payment-route.ts";
import { checkRouteTargetAllowanceTool, prepareRouteTargetAllowanceTool } from "./route-target-allowance.ts";
import { getAgentWalletTool, prepareWalletCreationTool } from "./wallet-setup.ts";
import { parseX402PaymentRequiredTool } from "./x402.ts";

describe("Celo MCP tool schemas", () => {
  it("advertises only Celo mainnet and Sepolia as home chains", () => {
    const tools = [
      prepareAccountAdminTransactionTool,
      getBalanceTool,
      prepareContractCallTool,
      preparePaymentTool,
      quotePaymentRouteTool,
      checkRouteTargetAllowanceTool,
      prepareRouteTargetAllowanceTool,
      getAgentWalletTool,
      prepareWalletCreationTool,
    ];

    for (const tool of tools) {
      assert.deepEqual(tool.inputSchema.properties.homeChainId.enum, [42220, 11142220], tool.name);
    }
  });

  it("advertises only Celo stablecoins for source balances and spending", () => {
    assert.deepEqual(getBalanceTool.inputSchema.properties.tokenSymbols.items.enum, ["USDC", "USDT", "USDm"]);
    assert.deepEqual(prepareContractCallTool.inputSchema.properties.sourceTokenSymbol.enum, ["USDC", "USDT", "USDm"]);
    assert.deepEqual(preparePaymentTool.inputSchema.properties.sourceTokenSymbol.enum, ["USDC", "USDT", "USDm"]);
    assert.deepEqual(quotePaymentRouteTool.inputSchema.properties.sourceTokenSymbol.enum, ["USDC", "USDT", "USDm"]);
    assert.deepEqual(parseInvoicePaymentTool.inputSchema.properties.sourceTokenSymbol.enum, ["USDC", "USDT", "USDm"]);
    assert.deepEqual(parseX402PaymentRequiredTool.inputSchema.properties.sourceTokenSymbol.enum, ["USDC", "USDT", "USDm"]);
  });
});
