import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { keccak256 } from "ethers";

import {
  bindOwnerRuntimeArtifact,
  canonicalManifestSha256,
  loadProductionOnboardingConfig,
  parseProductionOnboardingConfig,
  readProductionOnboardingScopedToken,
  verifyProductionOnboardingRuntime,
  type ProductionOnboardingConfig,
} from "./runtime.ts";

const nowUnix = 1_768_000_000;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const factoryCode = "0x60006000";
const runtimeBytecode = `0x${"00".repeat(24)}`;
const runtimeArtifact = {
  bytecode: runtimeBytecode,
  immutableReferences: [{ start: 2, length: 20 }],
  creationCodeHash: hash("7"),
  runtimeTemplateHash: keccak256(runtimeBytecode),
};
const manifest = {
  environment: "production",
  chainId: 42220,
  setupMode: "PUBLIC",
  onboardingOrigin: "https://wallet.agentpay.site",
  factory: {
    address: address("3"),
    deploymentTxHash: hash("1"),
    deploymentBlock: 123,
    runtimeCodeHash: keccak256(factoryCode),
    executor: address("2"),
    usdc: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    policyVersion: "0x7ca42c75d0d0ce25c514495482839ca84b4d4e3e445080004653e98bdebeb16c",
  },
  account: {
    creationCodeHash: runtimeArtifact.creationCodeHash,
    runtimeTemplateHash: runtimeArtifact.runtimeTemplateHash,
    immutableReferences: runtimeArtifact.immutableReferences,
    routeTargets: [],
  },
  sponsor: {
    deployerAddress: address("a"),
    maxDeploymentsPerDay: 100,
    maxGasPerDeployment: 2_000_000,
    maxNativeCostPerDayWei: "1000000000000000000",
    maxPending: 8,
  },
};

function jwt(role = "agentpay_setup_web", expiresIn = 3_600, issuedAt = nowUnix) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, exp: issuedAt + expiresIn, iat: issuedAt })}.signature`;
}

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    AGENTPAY_ENVIRONMENT: "production",
    AGENTPAY_SETUP_MODE: "PUBLIC",
    AGENTPAY_SETUP_WEB_TOKEN_PATH: "/run/agentpay/setup-web.jwt",
    SUPABASE_URL: "https://zcwsmivbgcrfyrvfptxk.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_agentpay_test_key_1234567890",
    CELO_MAINNET_RPC_URL: "https://rpc.celo.tech",
    AGENTPAY_ONBOARDING_MANIFEST_PATH: "/run/agentpay/onboarding.json",
    AGENTPAY_ONBOARDING_MANIFEST_SHA256: canonicalManifestSha256(manifest),
    AGENTPAY_ACCOUNT_RUNTIME_ARTIFACT_PATH: "/run/agentpay/AgentPayAccountV2.runtime.json",
    AGENTPAY_FACTORY_ADDRESS: manifest.factory.address,
    AGENTPAY_FACTORY_RUNTIME_CODE_HASH: manifest.factory.runtimeCodeHash,
    AGENTPAY_COOKIE_HMAC_SECRET: "cookie-secret-that-is-at-least-thirty-two-bytes",
    AGENTPAY_CAPABILITY_HASH_SECRET: "capability-secret-that-is-at-least-thirty-two-bytes",
    AGENTPAY_TRUSTED_PROXY_IDENTITY: "proxy-identity-that-is-at-least-thirty-two-bytes",
    AGENTPAY_ONBOARDING_ORIGIN: "https://wallet.agentpay.site",
    SETUP_WEB_PORT: "3000",
    ...overrides,
  };
}

function parse(
  overrides: Record<string, string | undefined> = {},
  scopedToken = jwt(),
) {
  return parseProductionOnboardingConfig(validEnv(overrides), {
    manifestJson: JSON.stringify(manifest),
    runtimeArtifactJson: JSON.stringify(runtimeArtifact),
    scopedToken,
    nowUnix,
  });
}

describe("production onboarding runtime config", () => {
  it("loads only a scoped, expiring web token and exact pinned production artifacts", () => {
    const config = parse();
    assert.equal(config.mode, "PUBLIC");
    assert.equal(config.chainId, 42220);
    assert.equal(config.manifestSha256, canonicalManifestSha256(manifest));
    assert.equal(config.factoryAddress, manifest.factory.address);
    assert.equal(config.factoryRuntimeCodeHash, manifest.factory.runtimeCodeHash);
    assert.equal(config.supabaseApiKey, "sb_publishable_agentpay_test_key_1234567890");
    assert.equal(config.runtimeArtifact.runtimeTemplateHash, runtimeArtifact.runtimeTemplateHash);
    assert.equal("serviceRoleKey" in config, false);
    assert.equal("privateKey" in config, false);
  });

  it("rejects service roles, signing keys, testnet inputs, routes, USDC, weak secrets, and artifact drift", () => {
    const invalidEnvironments: Array<[string, Record<string, string | undefined>]> = [
      ["raw web token", { AGENTPAY_SETUP_WEB_TOKEN: jwt() }],
      ["worker token path", { AGENTPAY_SETUP_WORKER_TOKEN_PATH: "/run/agentpay/setup-worker.jwt" }],
      ["missing publishable key", { SUPABASE_PUBLISHABLE_KEY: undefined }],
      ["secret API key", { SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden" }],
      ["deployer key", { SETUP_DEPLOYER_PRIVATE_KEY: `0x${"1".repeat(64)}` }],
      ["worker deployer key", { AGENTPAY_SETUP_DEPLOYER_PRIVATE_KEY: `0x${"1".repeat(64)}` }],
      ["executor key", { AGENTPAY_EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}` }],
      ["testnet RPC", { CELO_SEPOLIA_RPC_URL: "https://testrpc.celo.tech" }],
      ["route targets", { AGENTPAY_INITIAL_ROUTE_TARGETS: address("b") }],
      ["USDC", { AGENTPAY_USDC_ADDRESS: address("b") }],
      ["weak cookie", { AGENTPAY_COOKIE_HMAC_SECRET: "short" }],
      ["wrong origin", { AGENTPAY_ONBOARDING_ORIGIN: "https://evil.example" }],
      ["wrong factory", { AGENTPAY_FACTORY_ADDRESS: address("b") }],
      ["wrong digest", { AGENTPAY_ONBOARDING_MANIFEST_SHA256: "f".repeat(64) }],
    ];
    for (const [label, mutation] of invalidEnvironments) {
      assert.throws(() => parse(mutation), { name: "Error" }, label);
    }
    for (const scopedToken of [
      jwt("service_role"),
      jwt("agentpay_setup_web", 899),
      jwt("agentpay_setup_web", 7_201),
    ]) {
      assert.throws(() => parse({}, scopedToken));
    }

    const routed: any = structuredClone(manifest);
    routed.account.routeTargets = [address("b")];
    assert.throws(() => parseProductionOnboardingConfig(validEnv(), {
      manifestJson: JSON.stringify(routed), runtimeArtifactJson: JSON.stringify(runtimeArtifact), scopedToken: jwt(), nowUnix,
    }));
    const driftedArtifact = { ...runtimeArtifact, bytecode: "0x6000" };
    assert.throws(() => parseProductionOnboardingConfig(validEnv(), {
      manifestJson: JSON.stringify(manifest), runtimeArtifactJson: JSON.stringify(driftedArtifact), scopedToken: jwt(), nowUnix,
    }));
  });

  it("binds the owner into every immutable runtime reference without mutating the artifact", () => {
    const config = parse();
    const original = config.runtimeArtifact.bytecode;
    const result = bindOwnerRuntimeArtifact(config.runtimeArtifact, address("b"));
    assert.equal(result.bytecode.slice(2 + 2 * 2, 2 + 2 * 22), "b".repeat(40));
    assert.equal(result.runtimeCodeHash, keccak256(result.bytecode));
    assert.equal(config.runtimeArtifact.bytecode, original);
  });

  it("loads the pinned manifest and runtime artifact from the configured read-only paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentpay-onboarding-"));
    const manifestPath = join(directory, "manifest.json");
    const runtimeArtifactPath = join(directory, "runtime.json");
    const tokenPath = join(directory, "setup-web.jwt");
    const liveNow = Math.floor(Date.now() / 1_000);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(runtimeArtifactPath, JSON.stringify(runtimeArtifact));
    await writeFile(tokenPath, jwt("agentpay_setup_web", 3_600, liveNow));
    try {
      const config = await loadProductionOnboardingConfig(validEnv({
        AGENTPAY_SETUP_WEB_TOKEN_PATH: tokenPath,
        AGENTPAY_ONBOARDING_MANIFEST_PATH: manifestPath,
        AGENTPAY_ACCOUNT_RUNTIME_ARTIFACT_PATH: runtimeArtifactPath,
      }));
      assert.equal(config.manifestPath, manifestPath);
      assert.equal(config.runtimeArtifactPath, runtimeArtifactPath);
      assert.equal(config.scopedWebTokenPath, tokenPath);

      const rotated = jwt("agentpay_setup_web", 3_900, liveNow);
      await writeFile(tokenPath, rotated);
      assert.equal(await readProductionOnboardingScopedToken(tokenPath, liveNow), rotated);
      await writeFile(tokenPath, jwt("agentpay_setup_worker", 3_600, liveNow));
      await assert.rejects(readProductionOnboardingScopedToken(tokenPath, liveNow));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("production onboarding runtime readiness", () => {
  it("accepts only exact agreement across env, manifest, database, RPC, and factory", async () => {
    const config = parse();
    await assert.doesNotReject(() => verifyProductionOnboardingRuntime(config, readiness(config)));

    const failures = [
      readiness(config, { chainId: 11142220 }),
      readiness(config, { factoryCode: "0x6001" }),
      readiness(config, { databaseMode: "DRAIN" }),
      readiness(config, { databaseManifestSha256: hash("b") }),
      readiness(config, { factoryExecutor: address("b") }),
      readiness(config, { factoryUsdc: address("b") }),
      readiness(config, { factoryCreationCodeHash: hash("b") }),
    ];
    for (const dependency of failures) {
      await assert.rejects(() => verifyProductionOnboardingRuntime(config, dependency), /SETUP_RUNTIME_MISMATCH/);
    }
  });
});

function readiness(
  config: ProductionOnboardingConfig,
  overrides: Partial<{
    chainId: number;
    factoryCode: string;
    databaseMode: "OFF" | "CANARY" | "PUBLIC" | "DRAIN";
    databaseManifestSha256: string;
    factoryExecutor: string;
    factoryUsdc: string;
    factoryCreationCodeHash: string;
  }> = {},
) {
  return {
    async getChainId() { return overrides.chainId ?? 42220; },
    async getFactoryCode() { return overrides.factoryCode ?? factoryCode; },
    async getFactoryIdentity() {
      return {
        executorAddress: overrides.factoryExecutor ?? config.manifest.factory.executor,
        usdc: overrides.factoryUsdc ?? config.manifest.factory.usdc,
        policyVersion: config.manifest.factory.policyVersion,
        accountCreationCodeHash: overrides.factoryCreationCodeHash ?? config.manifest.account.creationCodeHash,
      };
    },
    async readDatabaseRuntime() {
      return {
        environment: "production" as const,
        chainId: 42220 as const,
        setupMode: overrides.databaseMode ?? config.mode,
        manifestSha256: overrides.databaseManifestSha256 ?? `0x${config.manifestSha256}`,
        factoryAddress: config.factoryAddress,
        factoryRuntimeCodeHash: config.factoryRuntimeCodeHash,
        executorAddress: config.manifest.factory.executor,
        sponsorDeployerAddress: config.manifest.sponsor.deployerAddress,
        maxDeploymentsPerDay: config.manifest.sponsor.maxDeploymentsPerDay,
        maxGasPerDeployment: String(config.manifest.sponsor.maxGasPerDeployment),
        maxNativeCostPerDayWei: config.manifest.sponsor.maxNativeCostPerDayWei,
        maxPending: config.manifest.sponsor.maxPending,
      };
    },
  };
}
