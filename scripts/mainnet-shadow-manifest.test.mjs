import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAINNET_MIGRATION_HEAD,
  MAINNET_USDC_ADDRESS,
  buildMainnetShadowManifest,
  computeArtifactDigests,
  validateProductionEnvironmentIsolation,
  validateMainnetShadowManifest,
} from "./mainnet-shadow-manifest.mjs";

const artifactDigests = await computeArtifactDigests();

function makeManifest() {
  return buildMainnetShadowManifest({
    artifactDigests,
    generatedAt: "2026-07-13T00:00:00.000Z",
  });
}

function validate(manifest) {
  return validateMainnetShadowManifest(manifest, { artifactDigests });
}

function makeProductionEnv() {
  return {
    AGENTPAY_ENVIRONMENT: "production",
    AGENTPAY_HOME_CHAIN_ID: "42220",
    AGENTPAY_ACCOUNT_VERSION: "v2",
    CELO_MAINNET_RPC_URL: "https://rpc.provider.example/celo",
    CELO_MAINNET_RPC_FALLBACK_URL: "https://forno.celo.org",
    AGENTPAY_PUBLIC_SETUP_URL: "https://wallet.agentpay.site/celo/setup",
    SUPABASE_PRODUCTION_URL: "https://production-project.supabase.co",
    DIRECT_URL_PRODUCTION: "postgresql://production.example.invalid/postgres",
  };
}

describe("Celo mainnet shadow manifest", () => {
  it("accepts the generated production shadow in OFF mode", () => {
    const result = validate(makeManifest());
    assert.equal(result.valid, true, result.errors.join("; "));
    assert.deepEqual(makeManifest().contract.allowedTokens, [MAINNET_USDC_ADDRESS]);
    assert.equal(MAINNET_MIGRATION_HEAD, "20260717120000_celo_home_chain_boundary");
    assert.equal(makeManifest().database.migrationHead, MAINNET_MIGRATION_HEAD);
    assert.equal(makeManifest().release.migrationHead, MAINNET_MIGRATION_HEAD);
    assert.deepEqual(makeManifest().chain, {
      name: "Celo",
      chainId: 42220,
      caip2: "eip155:42220",
      nativeSymbol: "CELO",
      rpcEnvRef: "CELO_MAINNET_RPC_URL",
      fallbackRpcEnvRef: "CELO_MAINNET_RPC_FALLBACK_URL",
      fallbackRpcUrl: "https://forno.celo.org",
    });
    assert.deepEqual(makeManifest().onboarding, {
      setupMode: "OFF",
      setupUrl: "https://wallet.agentpay.site/celo/setup",
      readinessUrl: "https://wallet.agentpay.site/celo/setup/readyz",
      manifestPathEnvRef: "AGENTPAY_ONBOARDING_MANIFEST_PATH",
      manifestSha256EnvRef: "AGENTPAY_ONBOARDING_MANIFEST_SHA256",
      factoryAddressEnvRef: "AGENTPAY_FACTORY_ADDRESS",
      sponsorAddressEnvRef: "AGENTPAY_SETUP_SPONSOR_ADDRESS",
    });
  });

  it("rejects a staging chain or RPC reference in a production manifest", () => {
    const chainDrift = makeManifest();
    chainDrift.chain.chainId = 11142220;
    chainDrift.chain.caip2 = "eip155:11142220";
    let result = validate(chainDrift);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /chain\.chainId/);
    assert.match(result.errors.join("; "), /chain\.caip2/);

    const rpcDrift = makeManifest();
    rpcDrift.chain.rpcEnvRef = "CELO_SEPOLIA_RPC_URL";
    rpcDrift.chain.fallbackRpcUrl = "https://forno.celo-sepolia.celo-testnet.org";
    result = validate(rpcDrift);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /chain\.rpcEnvRef/);
    assert.match(result.errors.join("; "), /chain\.fallbackRpcUrl/);
  });

  it("rejects paid-gate drift from the exact mainnet x402 policy", () => {
    const manifest = makeManifest();
    manifest.x402.enabled = true;
    manifest.x402.network = "eip155:11142220";
    manifest.x402.asset = "USDT";
    manifest.x402.price = "$0.02";
    manifest.x402.priceAtomic = "20000";
    manifest.x402.syncSettle = false;
    manifest.x402.toolAllowlist = ["execute_payment", "prepare_payment"];

    const result = validate(manifest);
    assert.equal(result.valid, false);
    for (const field of ["enabled", "network", "asset", "price", "priceAtomic", "syncSettle", "toolAllowlist"]) {
      assert.match(result.errors.join("; "), new RegExp(`x402\\.${field}`));
    }
  });

  it("rejects non-USDC tokens or any route target in the production golden path", () => {
    const tokenDrift = makeManifest();
    tokenDrift.contract.allowedTokens = [MAINNET_USDC_ADDRESS, "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e"];
    const result = validate(tokenDrift);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /contract\.allowedTokens/);

    const routeDrift = makeManifest();
    routeDrift.contract.allowedRouteTargets = ["0x1111111111111111111111111111111111111111"];
    const routeResult = validate(routeDrift);
    assert.equal(routeResult.valid, false);
    assert.match(routeResult.errors.join("; "), /contract\.allowedRouteTargets/);
  });

  it("rejects release and creation-bytecode digest drift", () => {
    const manifest = makeManifest();
    manifest.release.packageLockSha256 = "0".repeat(64);
    manifest.release.creationBytecodeKeccak256 = `0x${"1".repeat(64)}`;
    manifest.contract.creationBytecodeHash = `0x${"1".repeat(64)}`;

    const result = validate(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /release\.packageLockSha256/);
    assert.match(result.errors.join("; "), /creationBytecode/);
  });

  it("keeps shadow nulls allowed but rejects an unprovisioned READY manifest", () => {
    const shadow = makeManifest();
    assert.equal(validate(shadow).valid, true);

    const ready = makeManifest();
    ready.status = "READY";
    ready.executionMode = "PUBLIC";
    const result = validate(ready);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /status/);
    assert.match(result.errors.join("; "), /executionMode/);
  });

  it("rejects secret-bearing fields and owner/executor reuse", () => {
    const manifest = makeManifest();
    manifest.database.serviceRoleKey = "should-never-be-in-a-manifest";
    manifest.contract.ownerAddress = "0x1111111111111111111111111111111111111111";
    manifest.contract.executorAddress = "0x1111111111111111111111111111111111111111";

    const result = validate(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /secret-bearing/);
    assert.match(result.errors.join("; "), /owner and executor/);
  });

  it("accepts an isolated production environment with only mainnet references", () => {
    const result = validateProductionEnvironmentIsolation(makeProductionEnv(), { manifest: makeManifest() });
    assert.equal(result.valid, true, result.errors.join("; "));
  });

  it("rejects an unsafe primary RPC, a non-Forno fallback, or setup URL drift", () => {
    const unsafePrimary = makeProductionEnv();
    unsafePrimary.CELO_MAINNET_RPC_URL = "http://127.0.0.1:8545";
    let result = validateProductionEnvironmentIsolation(unsafePrimary);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /CELO_MAINNET_RPC_URL/);

    const fallbackDrift = makeProductionEnv();
    fallbackDrift.CELO_MAINNET_RPC_FALLBACK_URL = "https://rpc.example.com";
    result = validateProductionEnvironmentIsolation(fallbackDrift);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /CELO_MAINNET_RPC_FALLBACK_URL/);

    const setupDrift = makeProductionEnv();
    setupDrift.AGENTPAY_PUBLIC_SETUP_URL = "https://celo.agentpay.site/setup";
    result = validateProductionEnvironmentIsolation(setupDrift);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /AGENTPAY_PUBLIC_SETUP_URL/);
  });

  it("rejects generic, staging, or non-OFF production environment configuration", () => {
    const env = makeProductionEnv();
    env.CELO_RPC_URL = "https://forno.celo-sepolia.celo-testnet.org";
    env.CELO_SEPOLIA_RPC_URL = "https://forno.celo-sepolia.celo-testnet.org";
    env.SUPABASE_URL = "https://qwywcungxmhoctmehcze.supabase.co";
    env.DIRECT_URL = "postgresql://staging.example.invalid/postgres";
    env.AGENTPAY_A2MCP_PAYMENT_ENABLED = "true";
    env.AGENTPAY_EXECUTION_MODE = "PUBLIC";

    const result = validateProductionEnvironmentIsolation(env, { manifest: makeManifest() });
    assert.equal(result.valid, false);
    for (const field of ["CELO_RPC_URL", "CELO_SEPOLIA_RPC_URL", "SUPABASE_URL", "DIRECT_URL", "AGENTPAY_A2MCP_PAYMENT_ENABLED", "AGENTPAY_EXECUTION_MODE"]) {
      assert.match(result.errors.join("; "), new RegExp(field));
    }
  });

  it("rejects a missing mainnet boundary and wrong production identity", () => {
    const env = makeProductionEnv();
    delete env.CELO_MAINNET_RPC_URL;
    delete env.CELO_MAINNET_RPC_FALLBACK_URL;
    env.AGENTPAY_ENVIRONMENT = "staging";
    env.AGENTPAY_HOME_CHAIN_ID = "11142220";
    env.AGENTPAY_ACCOUNT_VERSION = "v1";

    const result = validateProductionEnvironmentIsolation(env);
    assert.equal(result.valid, false);
    for (const field of ["AGENTPAY_ENVIRONMENT", "AGENTPAY_HOME_CHAIN_ID", "AGENTPAY_ACCOUNT_VERSION", "CELO_MAINNET_RPC_URL", "CELO_MAINNET_RPC_FALLBACK_URL"]) {
      assert.match(result.errors.join("; "), new RegExp(field));
    }
  });
});
