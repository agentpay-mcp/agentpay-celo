import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quotePaymentRoute } from "./quote-payment-route.ts";

const activeWallet = {
  ownerAddress: "0x2222222222222222222222222222222222222222",
  accountAddress: "0x3333333333333333333333333333333333333333",
  homeChainId: 42220,
  executorAddress: "0x4444444444444444444444444444444444444444",
  status: "ACTIVE" as const,
};

describe("quotePaymentRoute", () => {
  it("returns a local direct quote without calling LI.FI for same-chain same-token payments", async () => {
    const output = await quotePaymentRoute(
      {
        recipientAddress: "0x1111111111111111111111111111111111111111",
        destinationChainId: 42220,
        destinationTokenSymbol: "USDC",
        amountOut: "10",
        sourceTokenSymbol: "USDC",
      },
      {
        wallets: {
          async getActiveWallet() {
            return activeWallet;
          },
        },
        routes: {
          async quotePaymentRoute() {
            throw new Error("should not call LI.FI for direct payments");
          },
        },
        balances: {
          async hasSufficientTokenBalance(request) {
            assert.deepEqual(request, {
              accountAddress: activeWallet.accountAddress,
              chainId: 42220,
              tokenAddress: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
              tokenSymbol: "USDC",
              requiredAmount: "10",
            });
            return true;
          },
        },
      },
    );

    assert.deepEqual(output, {
      paymentType: "DIRECT",
      routeProvider: "DIRECT",
      sourceChainId: 42220,
      sourceChain: "Celo",
      destinationChainId: 42220,
      destinationChain: "Celo",
      sourceTokenSymbol: "USDC",
      sourceTokenAddress: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      destinationTokenSymbol: "USDC",
      destinationTokenAddress: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      amountOut: "10",
      maxAmountIn: "10",
      maxNativeFee: "0",
      maxNativeFeeDisplay: "0 CELO",
      routeTarget: "0x0000000000000000000000000000000000000000",
      routeCalldataHash: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      requiresRouteTargetAllowlist: false,
      estimatedFee: "0",
      estimatedEtaSeconds: 0,
      routeSummary: "Direct 10 USDC transfer on Celo.",
    });
  });

  it("returns LI.FI route target details for route allowlist review", async () => {
    const output = await quotePaymentRoute(
      {
        recipientAddress: "0x1111111111111111111111111111111111111111",
        destinationChainId: 8453,
        destinationTokenSymbol: "USDC",
        amountOut: "10",
      },
      {
        wallets: {
          async getActiveWallet() {
            return activeWallet;
          },
        },
        routes: {
          async quotePaymentRoute() {
            return {
              routeProvider: "LI.FI",
              sourceTokenAddress: "0x5555555555555555555555555555555555555555",
              destinationTokenAddress: "0x6666666666666666666666666666666666666666",
              maxAmountIn: "10.18",
              maxNativeFee: "2500000000000000",
              routeTarget: "0x7777777777777777777777777777777777777777",
              routeCalldata: "0x1234",
              routeCalldataHash: "0x56570de287d73cd1cb6092bb8fdee6173974955fdef345ae579ee9f475ea7432",
              routeSummary: "Swap USDC on Celo, bridge, and pay USDC on Base.",
              estimatedFee: "0.12",
              estimatedEtaSeconds: 120,
            };
          },
        },
        balances: {
          async hasSufficientTokenBalance(request) {
            assert.deepEqual(request, {
              accountAddress: activeWallet.accountAddress,
              chainId: 42220,
              tokenAddress: "0x5555555555555555555555555555555555555555",
              tokenSymbol: "USDC",
              requiredAmount: "10.18",
            });
            return true;
          },
        },
      },
    );

    assert.equal(output.paymentType, "SWAP_BRIDGE_PAY");
    assert.equal(output.maxNativeFee, "2500000000000000");
    assert.equal(output.maxNativeFeeDisplay, "0.0025 CELO");
    assert.equal(output.routeTarget, "0x7777777777777777777777777777777777777777");
    assert.equal(output.routeCalldataHash, "0x56570de287d73cd1cb6092bb8fdee6173974955fdef345ae579ee9f475ea7432");
    assert.equal(output.requiresRouteTargetAllowlist, true);
  });

  it("rejects quotes when the source token balance is insufficient", async () => {
    await assert.rejects(
      () =>
        quotePaymentRoute(
          {
            recipientAddress: "0x1111111111111111111111111111111111111111",
            destinationChainId: 8453,
            destinationTokenSymbol: "USDC",
            amountOut: "10",
          },
          {
            wallets: {
              async getActiveWallet() {
                return activeWallet;
              },
            },
            routes: {
              async quotePaymentRoute() {
                return {
                  routeProvider: "LI.FI",
                  sourceTokenAddress: "0x5555555555555555555555555555555555555555",
                  destinationTokenAddress: "0x6666666666666666666666666666666666666666",
                  maxAmountIn: "10.18",
                  maxNativeFee: "0",
                  routeTarget: "0x7777777777777777777777777777777777777777",
                  routeCalldata: "0x1234",
                  routeCalldataHash: "0x56570de287d73cd1cb6092bb8fdee6173974955fdef345ae579ee9f475ea7432",
                  routeSummary: "Swap USDC on Celo, bridge, and pay USDC on Base.",
                  estimatedFee: "0.12",
                  estimatedEtaSeconds: 120,
                };
              },
            },
            balances: {
              async hasSufficientTokenBalance() {
                return false;
              },
            },
          },
        ),
      /Insufficient AgentPay USDC balance/,
    );
  });
});
