import { z } from "zod";

export const SUPPORTED_CHAINS = {
  196: {
    id: 196,
    name: "X Layer",
    nativeCurrency: {
      symbol: "OKB",
      decimals: 18,
    },
  },
  1952: {
    id: 1952,
    name: "X Layer Testnet",
    nativeCurrency: {
      symbol: "OKB",
      decimals: 18,
    },
  },
  8453: {
    id: 8453,
    name: "Base",
    nativeCurrency: {
      symbol: "ETH",
      decimals: 18,
    },
  },
  42220: {
    id: 42220,
    name: "Celo",
    nativeCurrency: {
      symbol: "CELO",
      decimals: 18,
    },
  },
  11142220: {
    id: 11142220,
    name: "Celo Sepolia",
    nativeCurrency: {
      symbol: "CELO",
      decimals: 18,
    },
  },
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;
export type NativeCurrency = (typeof SUPPORTED_CHAINS)[SupportedChainId]["nativeCurrency"];

export const CELO_NETWORK_CHAIN_IDS = {
  mainnet: 42220,
  testnet: 11142220,
} as const;

export const CELO_NETWORKS = {
  mainnet: {
    chainId: 42220,
    caip2: "eip155:42220",
    name: "Celo Mainnet",
    nativeCurrency: { symbol: "CELO", decimals: 18 },
    rpcEnvName: "CELO_MAINNET_RPC_URL",
    fallbackRpcEnvName: "CELO_MAINNET_RPC_FALLBACK_URL",
    explorerUrl: "https://celoscan.io",
  },
  testnet: {
    chainId: 11142220,
    caip2: "eip155:11142220",
    name: "Celo Sepolia",
    nativeCurrency: { symbol: "CELO", decimals: 18 },
    rpcEnvName: "CELO_SEPOLIA_RPC_URL",
    explorerUrl: "https://celo-sepolia.blockscout.com",
  },
} as const;

export const CELO_WALLET_ADD_CHAIN_PARAMETERS = {
  42220: {
    chainId: "0xa4ec",
    chainName: "Celo Mainnet",
    nativeCurrency: {
      name: "Celo",
      symbol: "CELO",
      decimals: 18,
    },
    rpcUrls: ["https://forno.celo.org"],
    blockExplorerUrls: ["https://celoscan.io"],
  },
  11142220: {
    chainId: "0xaa044c",
    chainName: "Celo Sepolia",
    nativeCurrency: {
      name: "Celo",
      symbol: "CELO",
      decimals: 18,
    },
    rpcUrls: ["https://forno.celo-sepolia.celo-testnet.org"],
    blockExplorerUrls: ["https://celo-sepolia.blockscout.com"],
  },
} as const;

/**
 * Browser-safe helper source embedded into the OAuth, setup, and Review & Sign
 * pages. The host page must define `celoWalletNetworks` from
 * CELO_WALLET_ADD_CHAIN_PARAMETERS before this source.
 */
export const CELO_WALLET_SWITCH_CLIENT_SOURCE = `
  const walletErrorCode = (error) => {
    const value = error?.code ?? error?.data?.originalError?.code;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  };
  const ensureCeloWalletChain = async (provider, expectedChainId) => {
    const network = celoWalletNetworks[String(expectedChainId)];
    if (!network) throw new Error("The requested Celo network is not supported.");
    const readChainId = async () => String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (await readChainId() === network.chainId.toLowerCase()) return false;
    const switchNetwork = async () => {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: network.chainId }],
        });
      } catch (error) {
        if (walletErrorCode(error) === 4001) {
          throw new Error("Network switch to " + network.chainName + " was cancelled in your wallet.");
        }
        throw error;
      }
    };
    try {
      await switchNetwork();
    } catch (error) {
      if (walletErrorCode(error) !== 4902) throw error;
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [network],
        });
      } catch (addError) {
        if (walletErrorCode(addError) === 4001) {
          throw new Error("Adding " + network.chainName + " was cancelled in your wallet.");
        }
        throw addError;
      }
      if (await readChainId() !== network.chainId.toLowerCase()) {
        await switchNetwork();
      }
    }
    if (await readChainId() !== network.chainId.toLowerCase()) {
      throw new Error("Wallet did not switch to " + network.chainName + ".");
    }
    return true;
  };
`;

export const AGENTPAY_CELO_PUBLIC_URLS = {
  consumerMcp: "https://wallet.agentpay.site/celo/mcp",
  paidMcp: "https://mcp.agentpay.site/celo/mcp",
  setup: "https://wallet.agentpay.site/celo/setup",
  review: "https://wallet.agentpay.site/celo/review",
} as const;

export const celoNetworkSchema = z.enum(["mainnet", "testnet"]);
export const celoHomeChainIdSchema = z.union([z.literal(42220), z.literal(11142220)]);
export const networkSelectionShape = {
  network: celoNetworkSchema.optional(),
  homeChainId: celoHomeChainIdSchema.optional(),
} as const;

export type CeloNetwork = z.infer<typeof celoNetworkSchema>;
export type CeloHomeChainId = z.infer<typeof celoHomeChainIdSchema>;
export type NetworkSelectionInput = {
  network?: CeloNetwork;
  homeChainId?: CeloHomeChainId;
};

export function resolveCeloHomeChainId(
  input: NetworkSelectionInput,
  fallbackHomeChainId: CeloHomeChainId = 42220,
): CeloHomeChainId {
  const networkHomeChainId = input.network ? CELO_NETWORK_CHAIN_IDS[input.network] : undefined;

  if (networkHomeChainId !== undefined && input.homeChainId !== undefined && networkHomeChainId !== input.homeChainId) {
    throw new Error(`Network ${input.network} maps to chain ${networkHomeChainId}, but homeChainId ${input.homeChainId} was provided.`);
  }

  return input.homeChainId ?? networkHomeChainId ?? fallbackHomeChainId;
}

export function getCeloWalletAddChainParameter(chainId: number) {
  const network = CELO_WALLET_ADD_CHAIN_PARAMETERS[chainId as keyof typeof CELO_WALLET_ADD_CHAIN_PARAMETERS];
  if (!network) {
    throw new Error(`Unsupported Celo wallet chain ${chainId}.`);
  }
  return network;
}

export function getChainName(chainId: number): string {
  return SUPPORTED_CHAINS[chainId as SupportedChainId]?.name ?? `Chain ${chainId}`;
}

export function getNativeCurrency(chainId: number): NativeCurrency {
  const nativeCurrency = SUPPORTED_CHAINS[chainId as SupportedChainId]?.nativeCurrency;

  if (!nativeCurrency) {
    throw new Error(`Unsupported chain ${chainId}.`);
  }

  return nativeCurrency;
}

export function formatNativeAmount(atomicAmount: string, chainId: number): string {
  const nativeCurrency = getNativeCurrency(chainId);
  return `${atomicToDecimal(BigInt(atomicAmount), nativeCurrency.decimals)} ${nativeCurrency.symbol}`;
}

function atomicToDecimal(amount: bigint, decimals: number): string {
  const padded = amount.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fractional = padded.slice(-decimals).replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole;
}
