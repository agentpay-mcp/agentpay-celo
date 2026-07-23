import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethers";

export const MAINNET_CHAIN_ID = 42220;
export const STAGING_CHAIN_ID = 11142220;
export const MAINNET_CAIP2 = "eip155:42220";
export const MAINNET_USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
export const MAINNET_USDC_DECIMALS = 6;
export const MAINNET_USDC_CODE_HASH =
  "0x14254a76b7b2554180021c6390e814e73dee647ae91b7198da08de5145214493";
export const MAINNET_ACCOUNT_CREATION_BYTECODE_HASH =
  "0x2ede9e46a03a9b3d8e8dc322905443b0fedfabd324c54c73fe1c748f10d0152a";
export const MAINNET_MIGRATION_HEAD = "20260721160000_celo_x402_settlement_audit";
export const MAINNET_RPC_FALLBACK_URL = "https://forno.celo.org";
export const MAINNET_SETUP_URL = "https://wallet.agentpay.site/celo/setup";
export const MAINNET_SETUP_READINESS_URL = "https://wallet.agentpay.site/celo/setup/readyz";
export const MAINNET_X402_FACILITATOR_URL = "https://api.x402.celo.org";
export const MAINNET_EXECUTOR_GAS_MAX_CELO = "0.05";
export const ASSIGNED_CELO_ATTRIBUTION_TAG_PATTERN = /^celo_[a-z0-9_]{1,27}$/;
export const FORBIDDEN_PRODUCTION_RUNTIME_ENV_REFS = Object.freeze([
  "CELO_RPC_URL",
  "CELO_SEPOLIA_RPC_URL",
  "AGENTPAY_CELO_SEPOLIA_USDC_ADDRESS",
  "AGENTPAY_CELO_SEPOLIA_USDT_ADDRESS",
  "AGENTPAY_CELO_SEPOLIA_USDM_ADDRESS",
]);
export const MAINNET_SHADOW_MANIFEST_PATH = fileURLToPath(
  new URL("../ops/manifests/celo-mainnet.shadow.json", import.meta.url),
);

const HEX_HASH_PATTERN = /^0x[a-f0-9]{64}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;
const REQUIRED_SECRET_KEYS = new Set([
  "privateKey",
  "secret",
  "serviceRoleKey",
  "apiKey",
  "facilitatorCredential",
  "rawTransaction",
  "sessionSigningKey",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addIssue(issues, path, message) {
  issues.push(`${path}: ${message}`);
}

function requireRecord(value, path, issues) {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object");
    return false;
  }
  return true;
}

function requireEqual(value, expected, path, issues) {
  if (value !== expected) {
    addIssue(issues, path, `must equal ${JSON.stringify(expected)}`);
  }
}

function requireArrayEqual(value, expected, path, issues) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((entry, index) => entry !== expected[index])) {
    addIssue(issues, path, `must equal ${JSON.stringify(expected)}`);
  }
}

function requireNullableString(value, path, issues) {
  if (value !== null && typeof value !== "string") {
    addIssue(issues, path, "must be a string or null");
  }
}

function requireAddress(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    addIssue(issues, path, nullable ? "must be a valid address or null" : "must be a valid address");
  }
}

function requireHash(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== "string" || !HEX_HASH_PATTERN.test(value)) {
    addIssue(issues, path, nullable ? "must be a 32-byte hex hash or null" : "must be a 32-byte hex hash");
  }
}

function requireSha256(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    addIssue(issues, path, nullable ? "must be a SHA-256 digest or null" : "must be a SHA-256 digest");
  }
}

function visitForSecretKeys(value, path, issues) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitForSecretKeys(entry, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (REQUIRED_SECRET_KEYS.has(key)) {
      addIssue(issues, `${path}.${key}`, "secret-bearing fields are forbidden in a shadow manifest");
    }
    visitForSecretKeys(child, `${path}.${key}`, issues);
  }
}

export async function computeArtifactDigests(rootDir = fileURLToPath(new URL("..", import.meta.url))) {
  const lockfile = await readFile(`${rootDir}/package-lock.json`);
  const bytecodeText = (await readFile(`${rootDir}/packages/cli/assets/AgentPayAccount.bin`, "utf8")).trim();

  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(bytecodeText)) {
    throw new Error("AgentPayAccount.bin is not valid deploy bytecode.");
  }

  return {
    packageLockSha256: createHash("sha256").update(lockfile).digest("hex"),
    creationBytecodeKeccak256: keccak256(bytecodeText).toLowerCase(),
  };
}

export function buildMainnetShadowManifest({ artifactDigests, generatedAt } = {}) {
  if (!artifactDigests || typeof artifactDigests !== "object") {
    throw new Error("Artifact digests are required to build the mainnet shadow manifest.");
  }

  return {
    schemaVersion: 1,
    kind: "agentpay-mainnet-shadow-manifest",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    status: "SHADOW_ONLY",
    environment: "production",
    executionMode: "OFF",
    chain: {
      name: "Celo",
      chainId: MAINNET_CHAIN_ID,
      caip2: MAINNET_CAIP2,
      nativeSymbol: "CELO",
      rpcEnvRef: "CELO_MAINNET_RPC_URL",
      fallbackRpcEnvRef: "CELO_MAINNET_RPC_FALLBACK_URL",
      fallbackRpcUrl: MAINNET_RPC_FALLBACK_URL,
    },
    database: {
      environment: "production",
      projectRef: null,
      urlEnvRef: "SUPABASE_PRODUCTION_URL",
      serviceRoleKeyEnvRef: "SUPABASE_PRODUCTION_SERVICE_ROLE_KEY",
      databaseUrlEnvRef: "DIRECT_URL_PRODUCTION",
      migrationHead: MAINNET_MIGRATION_HEAD,
    },
    secretRefs: {
      namespace: "agentpay-celo/production",
      executorPrivateKeyEnvRef: "EXECUTOR_PRIVATE_KEY",
      setupDeployerPrivateKeyEnvRef: "SETUP_DEPLOYER_PRIVATE_KEY",
      sessionHashKeyEnvRef: "AGENTPAY_SESSION_HASH_KEY",
      reviewTokenSecretEnvRef: "AGENTPAY_REVIEW_TOKEN_SECRET",
      rawTransactionEncryptionKeyEnvRef: "AGENTPAY_RAW_TX_ENCRYPTION_KEY",
    },
    release: {
      commit: null,
      packageLockSha256: artifactDigests.packageLockSha256,
      creationBytecodeKeccak256: artifactDigests.creationBytecodeKeccak256,
      runtimeBytecodeKeccak256: null,
      abiSha256: null,
      migrationHead: MAINNET_MIGRATION_HEAD,
    },
    contract: {
      version: "v2",
      address: null,
      deploymentTxHash: null,
      creationBytecodeHash: artifactDigests.creationBytecodeKeccak256,
      runtimeBytecodeHash: null,
      ownerAddress: null,
      executorAddress: null,
      deployerAddress: null,
      paused: null,
      domain: {
        name: "AgentPay",
        version: "1",
        chainId: MAINNET_CHAIN_ID,
        verifyingContract: null,
      },
      allowedTokens: [MAINNET_USDC_ADDRESS],
      allowedRouteTargets: [],
    },
    token: {
      symbol: "USDC",
      address: MAINNET_USDC_ADDRESS,
      decimals: MAINNET_USDC_DECIMALS,
      codeHash: MAINNET_USDC_CODE_HASH,
    },
    x402: {
      enabled: false,
      network: MAINNET_CAIP2,
      asset: "USDC",
      tokenAddress: MAINNET_USDC_ADDRESS,
      decimals: MAINNET_USDC_DECIMALS,
      price: "$0.01",
      priceAtomic: "10000",
      syncSettle: true,
      payToEnvRef: "AGENTPAY_A2MCP_PAYMENT_PAY_TO",
      facilitatorEnvRef: "AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL",
      facilitatorUrl: MAINNET_X402_FACILITATOR_URL,
      toolAllowlist: ["execute_payment"],
    },
    domains: {
      publicOrigin: null,
      consumerOrigin: "https://wallet.agentpay.site/celo/mcp",
      siweAudience: "https://wallet.agentpay.site/celo/mcp",
    },
    onboarding: {
      setupMode: "OFF",
      setupUrl: MAINNET_SETUP_URL,
      readinessUrl: MAINNET_SETUP_READINESS_URL,
      manifestPathEnvRef: "AGENTPAY_ONBOARDING_MANIFEST_PATH",
      manifestSha256EnvRef: "AGENTPAY_ONBOARDING_MANIFEST_SHA256",
      factoryAddressEnvRef: "AGENTPAY_FACTORY_ADDRESS",
      sponsorAddressEnvRef: "AGENTPAY_SETUP_SPONSOR_ADDRESS",
    },
    attribution: {
      standard: "ERC-8021",
      tagEnvRef: "CELO_ATTRIBUTION_TAG",
      appliesTo: ["agentpay-direct-transactions"],
      excludes: ["x402-facilitator-settlements"],
    },
    canaryPolicy: {
      maxAcceptedLifecycles: 1,
      invoiceMaxUsdc: "0.10",
      accountFundingUsdc: "0.10",
      payerFeeWalletFundingMaxUsdc: "0.02",
      aspFeeUsdc: "0.01",
      maxNativeFee: "0",
      executorGasMaxCelo: MAINNET_EXECUTOR_GAS_MAX_CELO,
      allowlistedTenantId: null,
      allowlistedOwnerAddress: null,
      allowlistedAccountAddress: null,
      payerAddress: null,
      recipientAddress: null,
    },
    isolation: {
      stagingChainId: STAGING_CHAIN_ID,
      productionChainId: MAINNET_CHAIN_ID,
      forbiddenRuntimeEnvRefs: [
        ...FORBIDDEN_PRODUCTION_RUNTIME_ENV_REFS,
      ],
      secretNamespaces: {
        staging: "agentpay-celo/staging",
        production: "agentpay-celo/production",
      },
      separateSupabase: true,
      separateExecutor: true,
      separateDeployment: true,
    },
  };
}

export function validateMainnetShadowManifest(manifest, { artifactDigests } = {}) {
  const issues = [];

  if (!requireRecord(manifest, "manifest", issues)) {
    return { valid: false, errors: issues };
  }

  visitForSecretKeys(manifest, "manifest", issues);
  requireEqual(manifest.schemaVersion, 1, "schemaVersion", issues);
  requireEqual(manifest.kind, "agentpay-mainnet-shadow-manifest", "kind", issues);
  requireEqual(manifest.status, "SHADOW_ONLY", "status", issues);
  requireEqual(manifest.environment, "production", "environment", issues);
  requireEqual(manifest.executionMode, "OFF", "executionMode", issues);

  if (manifest.generatedAt !== undefined && (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt)))) {
    addIssue(issues, "generatedAt", "must be a valid ISO timestamp when present");
  }

  const chain = manifest.chain;
  if (requireRecord(chain, "chain", issues)) {
    requireEqual(chain.name, "Celo", "chain.name", issues);
    requireEqual(chain.chainId, MAINNET_CHAIN_ID, "chain.chainId", issues);
    requireEqual(chain.caip2, MAINNET_CAIP2, "chain.caip2", issues);
    requireEqual(chain.nativeSymbol, "CELO", "chain.nativeSymbol", issues);
    requireEqual(chain.rpcEnvRef, "CELO_MAINNET_RPC_URL", "chain.rpcEnvRef", issues);
    requireEqual(
      chain.fallbackRpcEnvRef,
      "CELO_MAINNET_RPC_FALLBACK_URL",
      "chain.fallbackRpcEnvRef",
      issues,
    );
    requireEqual(chain.fallbackRpcUrl, MAINNET_RPC_FALLBACK_URL, "chain.fallbackRpcUrl", issues);
  }

  const database = manifest.database;
  if (requireRecord(database, "database", issues)) {
    requireEqual(database.environment, "production", "database.environment", issues);
    requireEqual(database.urlEnvRef, "SUPABASE_PRODUCTION_URL", "database.urlEnvRef", issues);
    requireEqual(database.serviceRoleKeyEnvRef, "SUPABASE_PRODUCTION_SERVICE_ROLE_KEY", "database.serviceRoleKeyEnvRef", issues);
    requireEqual(database.databaseUrlEnvRef, "DIRECT_URL_PRODUCTION", "database.databaseUrlEnvRef", issues);
    requireEqual(database.migrationHead, MAINNET_MIGRATION_HEAD, "database.migrationHead", issues);
    requireNullableString(database.projectRef, "database.projectRef", issues);
    if (database.projectRef !== null && !/^[a-z0-9]{20}$/.test(database.projectRef)) {
      addIssue(issues, "database.projectRef", "must be a Supabase project ref or null in shadow mode");
    }
  }

  const secretRefs = manifest.secretRefs;
  if (requireRecord(secretRefs, "secretRefs", issues)) {
    requireEqual(secretRefs.namespace, "agentpay-celo/production", "secretRefs.namespace", issues);
    requireEqual(secretRefs.executorPrivateKeyEnvRef, "EXECUTOR_PRIVATE_KEY", "secretRefs.executorPrivateKeyEnvRef", issues);
    requireEqual(secretRefs.setupDeployerPrivateKeyEnvRef, "SETUP_DEPLOYER_PRIVATE_KEY", "secretRefs.setupDeployerPrivateKeyEnvRef", issues);
    requireEqual(secretRefs.sessionHashKeyEnvRef, "AGENTPAY_SESSION_HASH_KEY", "secretRefs.sessionHashKeyEnvRef", issues);
    requireEqual(secretRefs.reviewTokenSecretEnvRef, "AGENTPAY_REVIEW_TOKEN_SECRET", "secretRefs.reviewTokenSecretEnvRef", issues);
    requireEqual(
      secretRefs.rawTransactionEncryptionKeyEnvRef,
      "AGENTPAY_RAW_TX_ENCRYPTION_KEY",
      "secretRefs.rawTransactionEncryptionKeyEnvRef",
      issues,
    );
  }

  const release = manifest.release;
  if (requireRecord(release, "release", issues)) {
    requireNullableString(release.commit, "release.commit", issues);
    requireSha256(release.packageLockSha256, "release.packageLockSha256", issues);
    requireHash(release.creationBytecodeKeccak256, "release.creationBytecodeKeccak256", issues);
    requireEqual(
      release.creationBytecodeKeccak256?.toLowerCase(),
      MAINNET_ACCOUNT_CREATION_BYTECODE_HASH.toLowerCase(),
      "release.creationBytecodeKeccak256",
      issues,
    );
    requireHash(release.runtimeBytecodeKeccak256, "release.runtimeBytecodeKeccak256", issues, { nullable: true });
    requireSha256(release.abiSha256, "release.abiSha256", issues, { nullable: true });
    requireEqual(release.migrationHead, MAINNET_MIGRATION_HEAD, "release.migrationHead", issues);
  }

  const contract = manifest.contract;
  if (requireRecord(contract, "contract", issues)) {
    requireEqual(contract.version, "v2", "contract.version", issues);
    requireAddress(contract.address, "contract.address", issues, { nullable: true });
    requireHash(contract.deploymentTxHash, "contract.deploymentTxHash", issues, { nullable: true });
    requireHash(contract.creationBytecodeHash, "contract.creationBytecodeHash", issues);
    requireEqual(
      contract.creationBytecodeHash?.toLowerCase(),
      MAINNET_ACCOUNT_CREATION_BYTECODE_HASH.toLowerCase(),
      "contract.creationBytecodeHash",
      issues,
    );
    requireHash(contract.runtimeBytecodeHash, "contract.runtimeBytecodeHash", issues, { nullable: true });
    requireAddress(contract.ownerAddress, "contract.ownerAddress", issues, { nullable: true });
    requireAddress(contract.executorAddress, "contract.executorAddress", issues, { nullable: true });
    requireAddress(contract.deployerAddress, "contract.deployerAddress", issues, { nullable: true });
    if (contract.ownerAddress && contract.executorAddress && contract.ownerAddress.toLowerCase() === contract.executorAddress.toLowerCase()) {
      addIssue(issues, "contract", "owner and executor must be different addresses");
    }
    if (contract.deployerAddress && contract.executorAddress && contract.deployerAddress.toLowerCase() === contract.executorAddress.toLowerCase()) {
      addIssue(issues, "contract", "deployer and executor must be different addresses");
    }
    if (contract.paused !== null && typeof contract.paused !== "boolean") {
      addIssue(issues, "contract.paused", "must be boolean or null");
    }
    if (requireRecord(contract.domain, "contract.domain", issues)) {
      requireEqual(contract.domain.name, "AgentPay", "contract.domain.name", issues);
      requireEqual(contract.domain.version, "1", "contract.domain.version", issues);
      requireEqual(contract.domain.chainId, MAINNET_CHAIN_ID, "contract.domain.chainId", issues);
      requireAddress(contract.domain.verifyingContract, "contract.domain.verifyingContract", issues, { nullable: true });
    }
    requireArrayEqual(contract.allowedTokens, [MAINNET_USDC_ADDRESS], "contract.allowedTokens", issues);
    requireArrayEqual(contract.allowedRouteTargets, [], "contract.allowedRouteTargets", issues);
  }

  const token = manifest.token;
  if (requireRecord(token, "token", issues)) {
    requireEqual(token.symbol, "USDC", "token.symbol", issues);
    requireEqual(token.address?.toLowerCase(), MAINNET_USDC_ADDRESS.toLowerCase(), "token.address", issues);
    requireEqual(token.decimals, MAINNET_USDC_DECIMALS, "token.decimals", issues);
    requireEqual(token.codeHash?.toLowerCase(), MAINNET_USDC_CODE_HASH.toLowerCase(), "token.codeHash", issues);
  }

  const x402 = manifest.x402;
  if (requireRecord(x402, "x402", issues)) {
    requireEqual(x402.enabled, false, "x402.enabled", issues);
    requireEqual(x402.network, MAINNET_CAIP2, "x402.network", issues);
    requireEqual(x402.asset, "USDC", "x402.asset", issues);
    requireEqual(x402.tokenAddress?.toLowerCase(), MAINNET_USDC_ADDRESS.toLowerCase(), "x402.tokenAddress", issues);
    requireEqual(x402.decimals, MAINNET_USDC_DECIMALS, "x402.decimals", issues);
    requireEqual(x402.price, "$0.01", "x402.price", issues);
    requireEqual(x402.priceAtomic, "10000", "x402.priceAtomic", issues);
    requireEqual(x402.syncSettle, true, "x402.syncSettle", issues);
    requireEqual(x402.payToEnvRef, "AGENTPAY_A2MCP_PAYMENT_PAY_TO", "x402.payToEnvRef", issues);
    requireEqual(x402.facilitatorEnvRef, "AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL", "x402.facilitatorEnvRef", issues);
    requireEqual(x402.facilitatorUrl, MAINNET_X402_FACILITATOR_URL, "x402.facilitatorUrl", issues);
    requireArrayEqual(x402.toolAllowlist, ["execute_payment"], "x402.toolAllowlist", issues);
  }

  const domains = manifest.domains;
  if (requireRecord(domains, "domains", issues)) {
    requireNullableString(domains.publicOrigin, "domains.publicOrigin", issues);
    requireEqual(domains.consumerOrigin, "https://wallet.agentpay.site/celo/mcp", "domains.consumerOrigin", issues);
    requireEqual(domains.siweAudience, "https://wallet.agentpay.site/celo/mcp", "domains.siweAudience", issues);
  }

  const onboarding = manifest.onboarding;
  if (requireRecord(onboarding, "onboarding", issues)) {
    requireEqual(onboarding.setupMode, "OFF", "onboarding.setupMode", issues);
    requireEqual(onboarding.setupUrl, MAINNET_SETUP_URL, "onboarding.setupUrl", issues);
    requireEqual(onboarding.readinessUrl, MAINNET_SETUP_READINESS_URL, "onboarding.readinessUrl", issues);
    requireEqual(
      onboarding.manifestPathEnvRef,
      "AGENTPAY_ONBOARDING_MANIFEST_PATH",
      "onboarding.manifestPathEnvRef",
      issues,
    );
    requireEqual(
      onboarding.manifestSha256EnvRef,
      "AGENTPAY_ONBOARDING_MANIFEST_SHA256",
      "onboarding.manifestSha256EnvRef",
      issues,
    );
    requireEqual(
      onboarding.factoryAddressEnvRef,
      "AGENTPAY_FACTORY_ADDRESS",
      "onboarding.factoryAddressEnvRef",
      issues,
    );
    requireEqual(
      onboarding.sponsorAddressEnvRef,
      "AGENTPAY_SETUP_SPONSOR_ADDRESS",
      "onboarding.sponsorAddressEnvRef",
      issues,
    );
  }

  const attribution = manifest.attribution;
  if (requireRecord(attribution, "attribution", issues)) {
    requireEqual(attribution.standard, "ERC-8021", "attribution.standard", issues);
    requireEqual(attribution.tagEnvRef, "CELO_ATTRIBUTION_TAG", "attribution.tagEnvRef", issues);
    requireEqual(
      JSON.stringify(attribution.appliesTo),
      JSON.stringify(["agentpay-direct-transactions"]),
      "attribution.appliesTo",
      issues,
    );
    requireEqual(
      JSON.stringify(attribution.excludes),
      JSON.stringify(["x402-facilitator-settlements"]),
      "attribution.excludes",
      issues,
    );
  }

  const canary = manifest.canaryPolicy;
  if (requireRecord(canary, "canaryPolicy", issues)) {
    requireEqual(canary.maxAcceptedLifecycles, 1, "canaryPolicy.maxAcceptedLifecycles", issues);
    requireEqual(canary.invoiceMaxUsdc, "0.10", "canaryPolicy.invoiceMaxUsdc", issues);
    requireEqual(canary.accountFundingUsdc, "0.10", "canaryPolicy.accountFundingUsdc", issues);
    requireEqual(canary.payerFeeWalletFundingMaxUsdc, "0.02", "canaryPolicy.payerFeeWalletFundingMaxUsdc", issues);
    requireEqual(canary.aspFeeUsdc, "0.01", "canaryPolicy.aspFeeUsdc", issues);
    requireEqual(canary.maxNativeFee, "0", "canaryPolicy.maxNativeFee", issues);
    requireEqual(
      canary.executorGasMaxCelo,
      MAINNET_EXECUTOR_GAS_MAX_CELO,
      "canaryPolicy.executorGasMaxCelo",
      issues,
    );
    for (const key of [
      "allowlistedTenantId",
      "allowlistedOwnerAddress",
      "allowlistedAccountAddress",
      "payerAddress",
      "recipientAddress",
    ]) {
      requireNullableString(canary[key], `canaryPolicy.${key}`, issues);
    }
  }

  const isolation = manifest.isolation;
  if (requireRecord(isolation, "isolation", issues)) {
    requireEqual(isolation.stagingChainId, STAGING_CHAIN_ID, "isolation.stagingChainId", issues);
    requireEqual(isolation.productionChainId, MAINNET_CHAIN_ID, "isolation.productionChainId", issues);
    requireArrayEqual(
      isolation.forbiddenRuntimeEnvRefs,
      FORBIDDEN_PRODUCTION_RUNTIME_ENV_REFS,
      "isolation.forbiddenRuntimeEnvRefs",
      issues,
    );
    if (requireRecord(isolation.secretNamespaces, "isolation.secretNamespaces", issues)) {
      requireEqual(isolation.secretNamespaces.staging, "agentpay-celo/staging", "isolation.secretNamespaces.staging", issues);
      requireEqual(
        isolation.secretNamespaces.production,
        "agentpay-celo/production",
        "isolation.secretNamespaces.production",
        issues,
      );
    }
    requireEqual(isolation.separateSupabase, true, "isolation.separateSupabase", issues);
    requireEqual(isolation.separateExecutor, true, "isolation.separateExecutor", issues);
    requireEqual(isolation.separateDeployment, true, "isolation.separateDeployment", issues);
  }

  if (artifactDigests && typeof artifactDigests === "object") {
    requireEqual(
      manifest.release?.packageLockSha256,
      artifactDigests.packageLockSha256,
      "release.packageLockSha256",
      issues,
    );
    requireEqual(
      manifest.release?.creationBytecodeKeccak256?.toLowerCase(),
      artifactDigests.creationBytecodeKeccak256?.toLowerCase(),
      "release.creationBytecodeKeccak256",
      issues,
    );
    requireEqual(
      manifest.contract?.creationBytecodeHash?.toLowerCase(),
      artifactDigests.creationBytecodeKeccak256?.toLowerCase(),
      "contract.creationBytecodeHash",
      issues,
    );
  }

  return { valid: issues.length === 0, errors: issues };
}

function hasRuntimeValue(env, name) {
  return typeof env?.[name] === "string" && env[name].trim() !== "";
}

export function validateProductionEnvironmentIsolation(env, { manifest } = {}) {
  const issues = [];
  if (!isRecord(env)) {
    return { valid: false, errors: ["environment: must be an object"] };
  }

  requireEqual(env.AGENTPAY_ENVIRONMENT, "production", "AGENTPAY_ENVIRONMENT", issues);
  requireEqual(String(env.AGENTPAY_HOME_CHAIN_ID ?? ""), String(MAINNET_CHAIN_ID), "AGENTPAY_HOME_CHAIN_ID", issues);
  requireEqual(env.AGENTPAY_ACCOUNT_VERSION, "v2", "AGENTPAY_ACCOUNT_VERSION", issues);

  if (!hasRuntimeValue(env, "CELO_MAINNET_RPC_URL")) {
    addIssue(issues, "CELO_MAINNET_RPC_URL", "must be configured for production");
  } else {
    try {
      const rpcUrl = new URL(env.CELO_MAINNET_RPC_URL);
      if (
        rpcUrl.protocol !== "https:" ||
        ["localhost", "127.0.0.1", "::1"].includes(rpcUrl.hostname) ||
        /test|dev|staging/i.test(rpcUrl.hostname)
      ) {
        addIssue(issues, "CELO_MAINNET_RPC_URL", "must be a production HTTPS RPC URL");
      }
    } catch {
      addIssue(issues, "CELO_MAINNET_RPC_URL", "must be a valid HTTPS URL");
    }
  }

  requireEqual(
    env.CELO_MAINNET_RPC_FALLBACK_URL,
    MAINNET_RPC_FALLBACK_URL,
    "CELO_MAINNET_RPC_FALLBACK_URL",
    issues,
  );
  requireEqual(env.AGENTPAY_PUBLIC_SETUP_URL, MAINNET_SETUP_URL, "AGENTPAY_PUBLIC_SETUP_URL", issues);
  if (!ASSIGNED_CELO_ATTRIBUTION_TAG_PATTERN.test(String(env.CELO_ATTRIBUTION_TAG ?? ""))) {
    addIssue(issues, "CELO_ATTRIBUTION_TAG", "must be the assigned lowercase celo_ attribution code");
  }

  for (const name of FORBIDDEN_PRODUCTION_RUNTIME_ENV_REFS) {
    if (hasRuntimeValue(env, name)) {
      addIssue(issues, name, "must be absent in production");
    }
  }

  if (!hasRuntimeValue(env, "SUPABASE_PRODUCTION_URL")) {
    addIssue(issues, "SUPABASE_PRODUCTION_URL", "must be configured for production");
  }
  if (hasRuntimeValue(env, "SUPABASE_URL")) {
    addIssue(issues, "SUPABASE_URL", "generic Supabase URL is forbidden in production");
  }
  if (!hasRuntimeValue(env, "DIRECT_URL_PRODUCTION")) {
    addIssue(issues, "DIRECT_URL_PRODUCTION", "must be configured for production migrations");
  }
  if (hasRuntimeValue(env, "DIRECT_URL")) {
    addIssue(issues, "DIRECT_URL", "generic database URL is forbidden in production");
  }

  if (hasRuntimeValue(env, "AGENTPAY_A2MCP_PAYMENT_ENABLED")) {
    requireEqual(env.AGENTPAY_A2MCP_PAYMENT_ENABLED, "false", "AGENTPAY_A2MCP_PAYMENT_ENABLED", issues);
  }
  if (hasRuntimeValue(env, "AGENTPAY_EXECUTION_MODE")) {
    requireEqual(env.AGENTPAY_EXECUTION_MODE, "OFF", "AGENTPAY_EXECUTION_MODE", issues);
  }

  if (manifest) {
    const manifestResult = validateMainnetShadowManifest(manifest);
    for (const error of manifestResult.errors) {
      addIssue(issues, "manifest", error);
    }
  }

  return { valid: issues.length === 0, errors: issues };
}

export function assertMainnetShadowManifest(manifest, options = {}) {
  const result = validateMainnetShadowManifest(manifest, options);
  if (!result.valid) {
    throw new Error(`PRODUCTION_NOT_READY: invalid mainnet shadow manifest (${result.errors.join("; ")})`);
  }
  return manifest;
}
