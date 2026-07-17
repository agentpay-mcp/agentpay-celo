import { ContractFactory, id, JsonRpcProvider, keccak256, Wallet } from "ethers";

import type {
  AgentPayAccountDeployer,
  AgentPayAccountDeploymentRequest,
  AgentPayAccountDeploymentResult,
} from "./complete-wallet-setup.ts";

const agentPayAccountConstructorAbi = [
  "constructor(address initialOwner,address initialExecutor,address[] initialAllowedTokens,address[] initialAllowedRouteTargets)",
];
export const MAINNET_USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
export const MAINNET_USDT_ADDRESS = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
export const MAINNET_USDM_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a";

export const AGENT_PAY_ACCOUNT_V2_REQUIRED_SELECTORS = [
  functionSelector(
    "hashDirectAuthorization((bytes32,bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32))",
  ),
  functionSelector(
    "hashRouteAuthorization((bytes32,bytes32,bytes32,address,address,address,uint256,uint256,address,address,uint256,address,bytes32,uint256,uint256,uint256,bytes32))",
  ),
  functionSelector(
    "executeAuthorizedDirectPayment((bytes32,bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32),bytes)",
  ),
  functionSelector(
    "executeAuthorizedRoutePayment((bytes32,bytes32,bytes32,address,address,address,uint256,uint256,address,address,uint256,address,bytes32,uint256,uint256,uint256,bytes32),bytes,bytes)",
  ),
] as const;

export interface AgentPayAccountContractFactory {
  deploy(
    ownerAddress: string,
    executorAddress: string,
    initialAllowedTokenAddresses: string[],
    initialAllowedRouteTargets: string[],
  ): Promise<{
    target: unknown;
    deploymentTransaction(): { hash: string } | null;
    waitForDeployment(): Promise<unknown>;
  }>;
}

export interface EthersAgentPayAccountDeployerConfig {
  rpcUrl: string;
  rpcUrls?: Partial<Record<number, string>>;
  deployerPrivateKey: string;
  bytecode: string;
  accountVersion?: "v2";
  bytecodeHash?: string;
}

export function createContractFactoryAgentPayAccountDeployer(
  factory: AgentPayAccountContractFactory,
): AgentPayAccountDeployer {
  return {
    async deployAgentPayAccount(
      request: AgentPayAccountDeploymentRequest,
    ): Promise<AgentPayAccountDeploymentResult> {
      assertMainnetDeploymentAllowlist(request);
      const contract = await factory.deploy(
        request.ownerAddress,
        request.executorAddress,
        request.initialAllowedTokenAddresses,
        request.initialAllowedRouteTargets,
      );
      await contract.waitForDeployment();

      return {
        accountAddress: String(contract.target),
        deploymentTxHash: contract.deploymentTransaction()?.hash,
      };
    },
  };
}

export function createEthersAgentPayAccountDeployer(
  config: EthersAgentPayAccountDeployerConfig,
): AgentPayAccountDeployer {
  assertAgentPayAccountV2Bytecode(config.bytecode, config.bytecodeHash);
  const factories = new Map<string, AgentPayAccountContractFactory>();

  async function getFactory(homeChainId: number): Promise<AgentPayAccountContractFactory> {
    if (homeChainId === 42220 && !config.bytecodeHash) {
      throw new Error("Celo mainnet deployment requires AGENTPAY_ACCOUNT_BYTECODE_HASH pinning.");
    }
    const rpcUrl = resolveSetupRpcUrlForChain(config, homeChainId);
    const cacheKey = `${homeChainId}:${rpcUrl}`;
    const existing = factories.get(cacheKey);

    if (existing) {
      return existing;
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    assertSetupRpcChain(homeChainId, Number(network.chainId));
    const signer = new Wallet(config.deployerPrivateKey, provider);
    const factory = new ContractFactory(agentPayAccountConstructorAbi, config.bytecode, signer) as unknown as AgentPayAccountContractFactory;
    factories.set(cacheKey, factory);
    return factory;
  }

  return {
    async deployAgentPayAccount(request) {
      assertMainnetDeploymentAllowlist(request);
      return createContractFactoryAgentPayAccountDeployer(await getFactory(request.homeChainId)).deployAgentPayAccount(request);
    },
  };
}

export function assertMainnetDeploymentAllowlist(request: Pick<AgentPayAccountDeploymentRequest, "homeChainId" | "initialAllowedTokenAddresses" | "initialAllowedRouteTargets">): void {
  assertSupportedSetupChain(request.homeChainId);
  if (request.homeChainId !== 42220) {
    return;
  }

  if (!matchesCanonicalMainnetStablecoins(request.initialAllowedTokenAddresses)) {
    throw new Error("Celo mainnet deployment requires the canonical Celo USDC-only canary allowlist.");
  }
  if (request.initialAllowedRouteTargets.length !== 0) {
    throw new Error("Celo mainnet deployment requires an empty route-target allowlist.");
  }
}

export function assertSupportedSetupChain(chainId: number): void {
  if (chainId !== 42220 && chainId !== 11142220) {
    throw new Error(`Unsupported AgentPay setup chain ${chainId}; only Celo mainnet (42220) and Celo Sepolia (11142220) are allowed.`);
  }
}

/**
 * Reject a stale V1 asset before a setup deploy can broadcast. The optional
 * hash pins the exact creation artifact in production; selectors provide a
 * useful fail-closed guard for local artifact rotation and testnet builds.
 */
export function assertAgentPayAccountV2Bytecode(bytecode: string, expectedHash?: string): void {
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(bytecode)) {
    throw new Error("AgentPayAccountV2 bytecode must be non-empty creation bytecode.");
  }

  const normalizedBytecode = bytecode.toLowerCase();
  const missingSelector = AGENT_PAY_ACCOUNT_V2_REQUIRED_SELECTORS.find(
    (selector) => !normalizedBytecode.includes(selector.slice(2).toLowerCase()),
  );
  if (missingSelector) {
    throw new Error(`AgentPayAccountV2 bytecode is missing required selector ${missingSelector}.`);
  }

  if (expectedHash && keccak256(bytecode).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("AgentPayAccountV2 bytecode hash does not match the configured deployment manifest.");
  }
}

export function resolveSetupRpcUrlForChain(
  config: Pick<EthersAgentPayAccountDeployerConfig, "rpcUrl" | "rpcUrls">,
  chainId: number,
): string {
  if (chainId === 42220 && !config.rpcUrls?.[42220]) {
    throw new Error("Celo mainnet deployment requires an explicit CELO_MAINNET_RPC_URL mapping.");
  }
  return config.rpcUrls?.[chainId] ?? config.rpcUrl;
}

export function assertSetupRpcChain(expectedChainId: number, actualChainId: number): void {
  if (expectedChainId !== actualChainId) {
    throw new Error(`Setup RPC chain mismatch: expected Celo chain ${expectedChainId}, received ${actualChainId}.`);
  }
}

function matchesCanonicalMainnetStablecoins(addresses: readonly string[]): boolean {
  const normalized = new Set(addresses.map((address) => address.toLowerCase()));
  return normalized.size === 1 && normalized.has(MAINNET_USDC_ADDRESS.toLowerCase());
}

function functionSelector(signature: string): string {
  return id(signature).slice(0, 10);
}
