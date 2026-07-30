import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import {
  AGENTPAY_CELO_PUBLIC_URLS,
  CELO_NETWORKS,
  CELO_WALLET_ADD_CHAIN_PARAMETERS,
  getCeloWalletAddChainParameter,
  getNativeCurrency,
  networkSelectionShape,
} from "./chains.ts";

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

  it("pins the isolated Celo production network and public paths", () => {
    assert.deepEqual(CELO_NETWORKS.mainnet, {
      chainId: 42220,
      caip2: "eip155:42220",
      name: "Celo Mainnet",
      nativeCurrency: { symbol: "CELO", decimals: 18 },
      rpcEnvName: "CELO_MAINNET_RPC_URL",
      fallbackRpcEnvName: "CELO_MAINNET_RPC_FALLBACK_URL",
      explorerUrl: "https://celoscan.io",
    });
    assert.deepEqual(AGENTPAY_CELO_PUBLIC_URLS, {
      consumerMcp: "https://wallet.agentpay.site/celo/mcp",
      paidMcp: "https://mcp.agentpay.site/celo/mcp",
      setup: "https://wallet.agentpay.site/celo/setup",
      review: "https://wallet.agentpay.site/celo/review",
    });
  });

  it("pins official wallet add-chain metadata for Celo mainnet and Sepolia", () => {
    assert.deepEqual(CELO_WALLET_ADD_CHAIN_PARAMETERS, {
      42220: {
        chainId: "0xa4ec",
        chainName: "Celo Mainnet",
        nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
        rpcUrls: ["https://forno.celo.org"],
        blockExplorerUrls: ["https://celoscan.io"],
      },
      11142220: {
        chainId: "0xaa044c",
        chainName: "Celo Sepolia",
        nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
        rpcUrls: ["https://forno.celo-sepolia.celo-testnet.org"],
        blockExplorerUrls: ["https://celo-sepolia.blockscout.com"],
      },
    });
    assert.equal(getCeloWalletAddChainParameter(42220).chainId, "0xa4ec");
    assert.equal(getCeloWalletAddChainParameter(11142220).chainId, "0xaa044c");
    assert.throws(() => getCeloWalletAddChainParameter(1), /Unsupported Celo wallet chain 1/);
  });
});
