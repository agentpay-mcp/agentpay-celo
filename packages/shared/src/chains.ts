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
