import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interface, keccak256, TypedDataEncoder } from "ethers";

import {
  appendCeloAttributionTag,
  MAINNET_SETUP_ROUTE_ALLOWLIST_HASH,
  MAINNET_SETUP_TOKEN_ALLOWLIST_HASH,
  MAINNET_WALLET_SETUP_TYPES,
} from "@agentpay-ai/shared-celo";

import {
  MAINNET_ACCOUNT_CREATION_BYTECODE_HASH,
  MAINNET_LOG_BLOCK_RANGE,
  fetchLogsInChunks,
  verifyMainnetAccount,
  type MainnetLogScanOptions,
  type MainnetAccountVerificationReader,
} from "./mainnet-account-verifier.ts";
import { MAINNET_USDC_ADDRESS } from "../runtime/production-readiness.ts";

const MAINNET_USDT_ADDRESS = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";

const accountAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const executorAddress = `0x${"c".repeat(40)}`;
const factoryAddress = "0xdddddddddddddddddddddddddddddddddddddddd";
const deployerAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const factoryRuntimeCodeHash = "0xacf158d0950bc04fe98bb801a45eced68265b81b22d820e735a69037d2dd2254";
const creationHash = MAINNET_ACCOUNT_CREATION_BYTECODE_HASH;
const deploymentTxHash = `0x${"44".repeat(32)}`;
const stableHeadHash = `0x${"ab".repeat(32)}`;
type TestMainnetLogScanOptions = MainnetLogScanOptions & {
  getBlockHash: (blockNumber: number) => Promise<string | null>;
};

function scanOptions(overrides: Partial<TestMainnetLogScanOptions> = {}): TestMainnetLogScanOptions {
  return {
    getBlockHash: async () => stableHeadHash,
    ...overrides,
  };
}

const factoryInterface = new Interface([
  "function deployAccount((string setupIntentId,bytes32 deploymentNonce,address owner,address executor,uint256 homeChainId,string environment,uint256 deadline,address factory,bytes32 factoryRuntimeCodeHash,bytes32 deploymentSalt,address predictedAccount,bytes32 accountCreationCodeHash,bytes32 accountRuntimeCodeHash,address token,bytes32 tokenAllowlistHash,bytes32 routeAllowlistHash,bytes32 manifestSha256) authorization,bytes ownerSignature)",
  "event AccountDeployed(address indexed owner,address indexed account,bytes32 indexed salt,bytes32 authorizationHash)",
  "event AccountReused(address indexed owner,address indexed account,bytes32 indexed authorizationHash)",
]);
const domainSeparator = TypedDataEncoder.hashDomain({
  name: "AgentPay",
  version: "1",
  chainId: 42220,
  verifyingContract: accountAddress,
});

function reader(overrides: Partial<MainnetAccountVerificationReader> = {}): MainnetAccountVerificationReader {
  return {
    getChainId: async () => 42220,
    getCode: async () => "0x6001600055",
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, contractAddress: accountAddress }),
    getTransactionData: async () => "0x6001600055",
    getAccountState: async () => ({
      owner: ownerAddress,
      executor: executorAddress,
      paused: false,
      domainSeparator,
      allowedUsdc: true,
    }),
    getTokenState: async () => ({ code: "0x6002", decimals: 6 }),
    getAllowlistEvents: async () => ({ tokenEvents: [], routeTargetEvents: [] }),
    ...overrides,
  };
}

function expected(overrides: Record<string, unknown> = {}) {
  const runtimeCode = "0x6001600055";
  const tokenCode = "0x6002";
  return {
    accountAddress,
    deploymentTxHash: `0x${"44".repeat(32)}`,
    creationBytecodeHash: creationHash,
    runtimeBytecodeHash: keccak256(runtimeCode),
    ownerAddress,
    executorAddress,
    deployerAddress,
    domainSeparator,
    tokenAddress: MAINNET_USDC_ADDRESS,
    tokenCodeHash: keccak256(tokenCode),
    tokenDecimals: 6,
    ...overrides,
  };
}

function factoryAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    setupIntentId: "setup-production-verifier-0001",
    deploymentNonce: `0x${"11".repeat(32)}`,
    owner: ownerAddress,
    executor: executorAddress,
    homeChainId: 42220,
    environment: "production",
    deadline: "1784265300",
    factory: factoryAddress,
    factoryRuntimeCodeHash,
    deploymentSalt: `0x${"22".repeat(32)}`,
    predictedAccount: accountAddress,
    accountCreationCodeHash: creationHash,
    accountRuntimeCodeHash: expected().runtimeBytecodeHash,
    token: MAINNET_USDC_ADDRESS,
    tokenAllowlistHash: MAINNET_SETUP_TOKEN_ALLOWLIST_HASH,
    routeAllowlistHash: MAINNET_SETUP_ROUTE_ALLOWLIST_HASH,
    manifestSha256: `0x${"33".repeat(32)}`,
    ...overrides,
  };
}

function authorizationHash(authorization: ReturnType<typeof factoryAuthorization>): string {
  return TypedDataEncoder.hash(
    { name: "AgentPay Setup", version: "1", chainId: 42220, verifyingContract: authorization.factory },
    MAINNET_WALLET_SETUP_TYPES as never,
    authorization,
  ).toLowerCase();
}

function factoryLog(
  eventName: "AccountDeployed" | "AccountReused",
  authorization = factoryAuthorization(),
  eventAuthorizationHash = authorizationHash(authorization),
) {
  const values = eventName === "AccountDeployed"
    ? [authorization.owner, authorization.predictedAccount, authorization.deploymentSalt, eventAuthorizationHash]
    : [authorization.owner, authorization.predictedAccount, eventAuthorizationHash];
  const encoded = factoryInterface.encodeEventLog(factoryInterface.getEvent(eventName)!, values);
  return { address: factoryAddress, topics: encoded.topics, data: encoded.data };
}

function factoryReader(input: {
  authorization?: ReturnType<typeof factoryAuthorization>;
  from?: string;
  to?: string | null;
  data?: string;
  factoryCodeHash?: string | null;
  logs?: Array<{ address: string; topics: readonly string[]; data: string }>;
} = {}): MainnetAccountVerificationReader {
  const authorization = input.authorization ?? factoryAuthorization();
  const transactionData = input.data ?? appendCeloAttributionTag(
    factoryInterface.encodeFunctionData("deployAccount", [authorization, `0x${"12".repeat(65)}`]),
    "celo_agentpay",
  );
  return reader({
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: 100,
      contractAddress: null,
      transactionHash: `0x${deploymentTxHash.slice(2).toUpperCase()}`,
      logs: input.logs ?? [factoryLog("AccountDeployed", authorization)],
    }),
    getTransaction: async () => ({
      to: input.to === undefined ? factoryAddress : input.to,
      from: input.from ?? deployerAddress,
      data: transactionData,
    }),
    getCodeHash: async (address: string) =>
      address.toLowerCase() === factoryAddress.toLowerCase()
        ? (input.factoryCodeHash === undefined ? factoryRuntimeCodeHash : input.factoryCodeHash)
        : null,
  } as unknown as Partial<MainnetAccountVerificationReader>);
}

describe("mainnet AgentPayAccountV2 verifier", () => {
  it("limits historical log requests to the RPC block-range ceiling", async () => {
    const requests: Array<{ fromBlock: number; toBlock: number }> = [];
    const headHashRequests: number[] = [];
    const delays: number[] = [];
    let blockNumberRequests = 0;

    await fetchLogsInChunks(
      async () => {
        blockNumberRequests += 1;
        return 10_205;
      },
      async (filter) => {
        requests.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
        return [];
      },
      { address: accountAddress, topics: ["0xtopic"], fromBlock: 100 },
      scanOptions({
        getBlockHash: async (blockNumber) => {
          headHashRequests.push(blockNumber);
          return stableHeadHash;
        },
        interChunkDelayMs: 7,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      }),
    );

    assert.equal(MAINNET_LOG_BLOCK_RANGE, 5_000);
    assert.equal(blockNumberRequests, 1);
    assert.deepEqual(headHashRequests, [10_205, 10_205]);
    assert.deepEqual(requests, [
      { fromBlock: 100, toBlock: 5_099 },
      { fromBlock: 5_100, toBlock: 10_099 },
      { fromBlock: 10_100, toBlock: 10_205 },
    ]);
    assert.deepEqual(delays, [7, 7]);
  });

  it("fails closed when the scan starts after the captured latest block", async () => {
    await assert.rejects(
      fetchLogsInChunks(
        async () => 99,
        async () => [],
        { address: accountAddress, topics: ["0xtopic"], fromBlock: 100 },
        scanOptions({ sleep: async () => undefined }),
      ),
      /start block is after the latest block/i,
    );
  });

  it("retries a transient historical log failure before failing closed", async () => {
    let attempts = 0;

    await fetchLogsInChunks(
      async () => 100,
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("rate limited");
        return [];
      },
      { address: accountAddress, topics: ["0xtopic"], fromBlock: 100 },
      scanOptions({ maxAttempts: 2, sleep: async () => undefined }),
    );

    assert.equal(attempts, 2);
  });

  it("fails closed when the captured head changes during the historical scan", async () => {
    let headHashRequests = 0;

    await assert.rejects(
      fetchLogsInChunks(
        async () => 100,
        async () => [],
        { address: accountAddress, topics: ["0xtopic"], fromBlock: 100 },
        scanOptions({
          getBlockHash: async () => {
            headHashRequests += 1;
            return headHashRequests === 1 ? stableHeadHash : `0x${"cd".repeat(32)}`;
          },
          sleep: async () => undefined,
        }),
      ),
      /head changed|reorganization/i,
    );
    assert.equal(headHashRequests, 2);
  });

  it("keeps the exported chunk helper compatible when no scan options are provided", async () => {
    const logs = await fetchLogsInChunks(
      async () => 100,
      async () => [],
      { address: accountAddress, topics: ["0xtopic"], fromBlock: 100 },
    );

    assert.deepEqual(logs, []);
  });

  it("uses one captured production head for code, state, token, and historical event reads", async () => {
    const blockTags: Array<number | undefined> = [];
    const allowlistHeads: unknown[] = [];
    const capturedHead = { blockNumber: 205, blockHash: stableHeadHash };
    const baseReader = reader();
    const result = await verifyMainnetAccount(reader({
      getVerificationHead: async () => capturedHead,
      getCode: async (_address: string, blockTag?: number) => {
        blockTags.push(blockTag);
        return baseReader.getCode(_address);
      },
      getAccountState: async (_address: string, blockTag?: number) => {
        blockTags.push(blockTag);
        return baseReader.getAccountState(_address);
      },
      getTokenState: async (_address: string, blockTag?: number) => {
        blockTags.push(blockTag);
        return baseReader.getTokenState(_address);
      },
      getAllowlistEvents: async (_address: string, _fromBlock: number, head?: unknown) => {
        allowlistHeads.push(head);
        return { tokenEvents: [], routeTargetEvents: [] };
      },
    } as unknown as Partial<MainnetAccountVerificationReader>), expected());

    assert.equal(result.valid, true, result.errors.join("; "));
    assert.deepEqual(blockTags, [205, 205, 205]);
    assert.deepEqual(allowlistHeads, [capturedHead]);
  });

  it("accepts a read-only account observation when every production invariant matches", async () => {
    const result = await verifyMainnetAccount(reader(), expected());

    assert.equal(result.valid, true, result.errors.join("; "));
  });

  it("accepts the exact pinned factory deployment transaction and AccountDeployed receipt proof", async () => {
    const result = await verifyMainnetAccount(factoryReader(), expected());

    assert.equal(result.valid, true, result.errors.join("; "));
    assert.equal(result.checks["factory deployment proof"], true);
  });

  it("rejects wrong factory, deployer, transaction hash, malformed calldata, or factory runtime", async () => {
    const validReader = factoryReader();
    const variants: MainnetAccountVerificationReader[] = [
      { ...validReader, getTransaction: async () => null } as MainnetAccountVerificationReader,
      factoryReader({ to: "0x1111111111111111111111111111111111111111" }),
      factoryReader({ from: "0x1111111111111111111111111111111111111111" }),
      factoryReader({ data: "0x1234" }),
      factoryReader({ factoryCodeHash: `0x${"99".repeat(32)}` }),
      {
        ...validReader,
        getTransactionReceipt: async () => ({
          status: 1,
          blockNumber: 100,
          contractAddress: null,
          transactionHash: `0x${"55".repeat(32)}`,
          logs: [factoryLog("AccountDeployed")],
        }),
      } as MainnetAccountVerificationReader,
    ];

    for (const candidate of variants) {
      const result = await verifyMainnetAccount(candidate, expected());
      assert.equal(result.valid, false);
      assert.match(result.errors.join("; "), /factory|deployer|transaction|calldata|receipt/i);
    }
  });

  it("rejects authorization drift across every production factory policy binding", async () => {
    const hash = (digit: string) => `0x${digit.repeat(64)}`;
    const authorizationDrifts = [
      { owner: "0x1111111111111111111111111111111111111111" },
      { executor: "0x2222222222222222222222222222222222222222" },
      { homeChainId: 11142220 },
      { environment: "staging" },
      { factory: "0x3333333333333333333333333333333333333333" },
      { factoryRuntimeCodeHash: hash("4") },
      { predictedAccount: "0x5555555555555555555555555555555555555555" },
      { accountCreationCodeHash: hash("6") },
      { accountRuntimeCodeHash: hash("7") },
      { token: MAINNET_USDT_ADDRESS },
      { tokenAllowlistHash: hash("8") },
      { routeAllowlistHash: hash("9") },
    ];

    for (const drift of authorizationDrifts) {
      const result = await verifyMainnetAccount(
        factoryReader({ authorization: factoryAuthorization(drift) }),
        expected(),
      );
      assert.equal(result.valid, false);
      assert.match(result.errors.join("; "), /factory deployment authorization/i);
    }
  });

  it("rejects missing, ambiguous, malformed, mismatched, or AccountReused factory receipt events", async () => {
    const validEvent = factoryLog("AccountDeployed");
    const malformedEvent = { ...validEvent, data: "0x01" };
    const missingLogsReader = {
      ...factoryReader(),
      getTransactionReceipt: async () => ({
        status: 1,
        blockNumber: 100,
        contractAddress: null,
        transactionHash: deploymentTxHash,
        logs: null,
      }),
    } as unknown as MainnetAccountVerificationReader;
    const variants = [
      missingLogsReader,
      factoryReader({ logs: [] }),
      factoryReader({ logs: [null] as unknown as Array<{ address: string; topics: readonly string[]; data: string }> }),
      factoryReader({ logs: [validEvent, validEvent] }),
      factoryReader({ logs: [malformedEvent] }),
      factoryReader({ logs: [factoryLog("AccountDeployed", factoryAuthorization(), `0x${"99".repeat(32)}`)] }),
      factoryReader({ logs: [factoryLog("AccountReused")] }),
    ];

    for (const candidate of variants) {
      const result = await verifyMainnetAccount(candidate, expected());
      assert.equal(result.valid, false);
      assert.match(result.errors.join("; "), /AccountDeployed|AccountReused|factory deployment event/i);
    }
  });

  it("rejects chain, receipt, owner/executor, pause, domain, and token drift", async () => {
    const result = await verifyMainnetAccount(reader({
      getChainId: async () => 11142220,
      getTransactionReceipt: async () => ({ status: 0, blockNumber: 100, contractAddress: accountAddress }),
      getAccountState: async () => ({
        owner: executorAddress,
        executor: executorAddress,
        paused: true,
        domainSeparator: `0x${"99".repeat(32)}`,
        allowedUsdc: false,
      }),
      getTokenState: async () => ({ code: "0x6003", decimals: 18 }),
    }), expected());

    assert.equal(result.valid, false);
    for (const text of ["chain id", "deployment receipt", "owner and executor", "paused", "domain separator", "USDC", "decimals", "USDC code hash"]) {
      assert.match(result.errors.join("; "), new RegExp(text, "i"));
    }
  });

  it("rejects a route target or non-USDC token left enabled by deployment events", async () => {
    const result = await verifyMainnetAccount(reader({
      getAllowlistEvents: async () => ({
        tokenEvents: [
          { token: MAINNET_USDC_ADDRESS, allowed: true },
          { token: MAINNET_USDT_ADDRESS, allowed: true },
        ],
        routeTargetEvents: [{ target: "0xdddddddddddddddddddddddddddddddddddddddd", allowed: true }],
      }),
    }), expected());

    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /non-USDC|48065/i);
    assert.match(result.errors.join("; "), /route target/i);
  });

  it("rejects any historical forbidden enablement even when a later event disables it", async () => {
    const result = await verifyMainnetAccount(reader({
      getAllowlistEvents: async () => ({
        tokenEvents: [
          { token: MAINNET_USDT_ADDRESS, allowed: true },
          { token: MAINNET_USDT_ADDRESS, allowed: false },
        ],
        routeTargetEvents: [
          { target: factoryAddress, allowed: true },
          { target: factoryAddress, allowed: false },
        ],
      }),
    }), expected());

    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /non-USDC/i);
    assert.match(result.errors.join("; "), /route target/i);
  });

  it("fails closed when the deployment receipt omits its created account", async () => {
    const result = await verifyMainnetAccount(reader({
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, contractAddress: null }),
    }), expected());

    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /deployment receipt does not point/i);
  });

  it("fails closed when a deployment transaction or runtime code is missing", async () => {
    const result = await verifyMainnetAccount(reader({
      getCode: async () => "0x",
      getTransactionReceipt: async () => null,
    }), expected());

    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /runtime code|deployment receipt/i);
  });
});
