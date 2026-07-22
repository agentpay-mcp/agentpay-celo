import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AbiCoder, keccak256 } from "ethers";

import {
  MAINNET_ONBOARDING_URL,
  MAINNET_SETUP_CHAIN_ID,
  MAINNET_SETUP_ENVIRONMENT,
  MAINNET_SETUP_ROUTE_ALLOWLIST_HASH,
  MAINNET_SETUP_TOKEN_ALLOWLIST_HASH,
  MAINNET_SETUP_USDC,
  MAINNET_WALLET_SETUP_TYPES,
  createMainnetWalletSetupTypedData,
  mainnetWalletSetupChallengeResponseSchema,
  mainnetWalletSetupMessageSchema,
  mainnetWalletSetupPublicStatusSchema,
  mainnetWalletSetupTypedDataSchema,
  toEip712Sha256Bytes32,
  type MainnetWalletSetupMessage,
  type MainnetWalletSetupPolicyContext,
} from "./mainnet-wallet-setup.ts";

const owner = "0x1111111111111111111111111111111111111111";
const executor = "0x2222222222222222222222222222222222222222";
const factory = "0x3333333333333333333333333333333333333333";
const sponsor = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const predictedAccount = "0x5555555555555555555555555555555555555555";
const hash = (digit: string) => `0x${digit.repeat(64)}`;

function message(overrides: Partial<MainnetWalletSetupMessage> = {}): MainnetWalletSetupMessage {
  return {
    setupIntentId: "setup-intent-celo-0001",
    deploymentNonce: hash("1"),
    owner,
    executor,
    homeChainId: MAINNET_SETUP_CHAIN_ID,
    environment: MAINNET_SETUP_ENVIRONMENT,
    deadline: "2000000000",
    factory,
    factoryRuntimeCodeHash: hash("2"),
    deploymentSalt: hash("3"),
    predictedAccount,
    accountCreationCodeHash: hash("4"),
    accountRuntimeCodeHash: hash("5"),
    token: MAINNET_SETUP_USDC,
    tokenAllowlistHash: MAINNET_SETUP_TOKEN_ALLOWLIST_HASH,
    routeAllowlistHash: MAINNET_SETUP_ROUTE_ALLOWLIST_HASH,
    manifestSha256: hash("6"),
    ...overrides,
  };
}

function policy(
  setupMessage = message(),
  overrides: Partial<MainnetWalletSetupPolicyContext> = {},
): MainnetWalletSetupPolicyContext {
  return {
    ownerAddress: setupMessage.owner,
    executorAddress: setupMessage.executor,
    factoryAddress: setupMessage.factory,
    factoryRuntimeCodeHash: setupMessage.factoryRuntimeCodeHash,
    deploymentSalt: setupMessage.deploymentSalt,
    predictedAccount: setupMessage.predictedAccount,
    accountCreationCodeHash: setupMessage.accountCreationCodeHash,
    accountRuntimeCodeHash: setupMessage.accountRuntimeCodeHash,
    manifestSha256: setupMessage.manifestSha256,
    sponsorDeployerAddress: sponsor,
    currentUnixTime: 1_900_000_000,
    ...overrides,
  };
}

describe("Celo mainnet wallet setup policy", () => {
  it("pins Celo mainnet, canonical USDC, the isolated setup URL, and allowlist hashes", () => {
    const abiCoder = AbiCoder.defaultAbiCoder();

    assert.equal(MAINNET_SETUP_CHAIN_ID, 42220);
    assert.equal(MAINNET_SETUP_ENVIRONMENT, "production");
    assert.equal(MAINNET_SETUP_USDC, "0xcebA9300f2b948710d2653dD7B07f33A8B32118C");
    assert.equal(MAINNET_ONBOARDING_URL, "https://wallet.agentpay.site/celo/setup");
    assert.equal(
      MAINNET_SETUP_TOKEN_ALLOWLIST_HASH,
      keccak256(abiCoder.encode(["address[]"], [[MAINNET_SETUP_USDC]])),
    );
    assert.equal(MAINNET_SETUP_ROUTE_ALLOWLIST_HASH, keccak256(abiCoder.encode(["address[]"], [[]])));
  });

  it("creates a canonical deeply frozen EIP-712 envelope", () => {
    const setupMessage = message();
    const typedData = createMainnetWalletSetupTypedData(setupMessage, policy(setupMessage));

    assert.deepEqual(typedData.domain, {
      name: "AgentPay Setup",
      version: "1",
      chainId: 42220,
      verifyingContract: factory,
    });
    assert.equal(typedData.primaryType, "MainnetWalletSetup");
    assert.deepEqual(Object.keys(typedData.message), MAINNET_WALLET_SETUP_TYPES.MainnetWalletSetup.map(({ name }) => name));
    assert.equal(Object.isFrozen(typedData), true);
    assert.equal(Object.isFrozen(typedData.domain), true);
    assert.equal(Object.isFrozen(typedData.message), true);
    assert.equal(JSON.stringify(typedData).includes(sponsor), false);
  });

  it("rejects wrong-chain, mutable-token, expired, and overflowing policies", () => {
    assert.throws(() => createMainnetWalletSetupTypedData(message({ homeChainId: 11142220 } as never), policy()));
    assert.throws(() => createMainnetWalletSetupTypedData(message({ token: owner } as never), policy()));
    assert.throws(() => createMainnetWalletSetupTypedData(message({ deadline: "1900000000" }), policy()));
    assert.throws(() => createMainnetWalletSetupTypedData(message({ deadline: (1n << 256n).toString() }), policy()));
  });

  it("rejects any dynamic policy mismatch and actor collision", () => {
    const setupMessage = message();

    assert.throws(() =>
      createMainnetWalletSetupTypedData(setupMessage, policy(setupMessage, { predictedAccount: owner })),
    );
    assert.throws(() => createMainnetWalletSetupTypedData(message({ executor: owner }), policy()));
    assert.throws(() =>
      createMainnetWalletSetupTypedData(setupMessage, policy(setupMessage, { sponsorDeployerAddress: factory })),
    );
  });

  it("rejects malformed bytes, zero addresses, extra fields, and altered EIP-712 types", () => {
    assert.equal(mainnetWalletSetupMessageSchema.safeParse(message({ deploymentNonce: "0x1234" })).success, false);
    assert.equal(
      mainnetWalletSetupMessageSchema.safeParse(message({ owner: "0x0000000000000000000000000000000000000000" })).success,
      false,
    );
    assert.equal(mainnetWalletSetupMessageSchema.safeParse({ ...message(), unexpected: true }).success, false);

    const typedData = createMainnetWalletSetupTypedData(message(), policy());
    const altered = {
      ...typedData,
      types: {
        MainnetWalletSetup: typedData.types.MainnetWalletSetup.map((field, index) =>
          index === 0 ? { ...field, type: "bytes32" } : field,
        ),
      },
    };
    assert.equal(mainnetWalletSetupTypedDataSchema.safeParse(altered).success, false);
  });

  it("validates public challenge and status payloads without leaking worker authority", () => {
    const typedData = createMainnetWalletSetupTypedData(message(), policy());
    assert.equal(
      mainnetWalletSetupChallengeResponseSchema.safeParse({
        capability: "A".repeat(43),
        csrfToken: "E".repeat(43),
        typedData,
        expiresAt: "2026-08-01T00:00:00.000Z",
      }).success,
      true,
    );
    assert.equal(
      mainnetWalletSetupPublicStatusSchema.safeParse({
        setupIntentId: typedData.message.setupIntentId,
        status: "SETUP_PENDING",
        predictedAccount,
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      }).success,
      true,
    );
  });

  it("converts only bare SHA-256 digests to EIP-712 bytes32", () => {
    assert.equal(toEip712Sha256Bytes32("A".repeat(64)), `0x${"a".repeat(64)}`);
    assert.throws(() => toEip712Sha256Bytes32("0x" + "a".repeat(64)));
  });
});
