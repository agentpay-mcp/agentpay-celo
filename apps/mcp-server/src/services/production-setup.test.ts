import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ProductionSetupStoreError,
  createInMemoryProductionSetupStores,
  type ProductionSetupChallengeInput,
} from "./production-setup.ts";

const owner = "0x1111111111111111111111111111111111111111";
const executor = "0x2222222222222222222222222222222222222222";
const factory = "0x3333333333333333333333333333333333333333";
const deployer = "0x4444444444444444444444444444444444444444";
const predicted = "0x5555555555555555555555555555555555555555";
const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const bareHash = (digit: string) => digit.repeat(64);
const signature = `0x${"12".repeat(65)}`;
const at = "2026-07-17T05:00:00.000Z";

function challenge(overrides: Partial<ProductionSetupChallengeInput> = {}): ProductionSetupChallengeInput {
  return {
    setupIntentId: "setup-production-memory-0001",
    capabilityDigest: bareHash("a"),
    ownerAddress: owner,
    executorAddress: executor,
    messageToSign: "canonical typed data",
    homeChainId: 42220,
    deploymentNonce: hash("1"),
    manifestSha256: hash("2"),
    factoryAddress: factory,
    factoryRuntimeCodeHash: hash("3"),
    deploymentSalt: hash("4"),
    predictedAccount: predicted,
    accountCreationCodeHash: hash("5"),
    accountRuntimeCodeHash: hash("6"),
    authorizationHash: hash("7"),
    expiresAt: "2026-07-17T05:15:00.000Z",
    at,
    rateLimitKeyDigest: bareHash("f"),
    ...overrides,
  };
}

function createStores(maxDeploymentsPerDay = 10) {
  let id = 0;
  return createInMemoryProductionSetupStores({
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    createFencingToken: () => `10000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sponsorPolicy: {
      deployerAddress: deployer,
      maxDeploymentsPerDay,
      maxGasPerDeployment: 5_000_000n,
      maxNativeCostPerDayWei: 1_000_000_000_000_000_000n,
      maxPending: 4,
    },
  });
}

async function admittedStores() {
  const stores = createStores();
  await stores.web.challenge(challenge());
  await stores.web.admit({ capabilityDigest: bareHash("a"), ownerSetupSignature: signature, at });
  return stores;
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ProductionSetupStoreError && error.code === code;
}

describe("production setup in-memory stores", () => {
  it("binds one capability to immutable owner and policy fields", async () => {
    const stores = createStores();
    const created = await stores.web.challenge(challenge());
    const replay = await stores.web.challenge(challenge());
    assert.equal(created.disposition, "CREATED");
    assert.equal(replay.disposition, "REPLAY");

    await assert.rejects(
      stores.web.challenge(challenge({ ownerAddress: "0x9999999999999999999999999999999999999999" })),
      (error: unknown) => error instanceof ProductionSetupStoreError && error.code === "SETUP_REPLAY_CONFLICT",
    );

    const record = stores.inspect.intent("setup-production-memory-0001");
    assert.ok(record);
    assert.equal(Object.isFrozen(record), true);
    assert.throws(() => Object.assign(record!, { ownerAddress: deployer }), TypeError);
  });

  it("makes identical admission a replay and rejects a different setup signature", async () => {
    const stores = createStores();
    await stores.web.challenge(challenge());
    const admitted = await stores.web.admit({ capabilityDigest: bareHash("a"), ownerSetupSignature: signature, at });
    const replay = await stores.web.admit({ capabilityDigest: bareHash("a"), ownerSetupSignature: signature, at });
    assert.equal(admitted.disposition, "ADMITTED");
    assert.equal(replay.disposition, "REPLAY");
    assert.deepEqual(Object.keys(admitted).sort(), ["disposition", "jobId", "setupIntentId"]);

    await assert.rejects(
      stores.web.admit({ capabilityDigest: bareHash("a"), ownerSetupSignature: `0x${"34".repeat(65)}`, at }),
      (error: unknown) => error instanceof ProductionSetupStoreError && error.code === "SETUP_STATE_CONFLICT",
    );
  });

  it("preserves encrypted outbox bytes through the monotonic completed lifecycle", async () => {
    const stores = await admittedStores();
    const claimed = await stores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(claimed);
    assert.equal(claimed.ownerSetupSignature, signature);
    assert.equal(Object.isFrozen(claimed), true);

    await stores.worker.reserve({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      deployerAddress: deployer,
      deployerNonce: "7",
      gasLimit: "1000000",
      nativeCostWei: "1000000000000000",
      at,
    });
    const encrypted = Object.freeze({ ciphertext: "ciphertext", iv: "iv", tag: "tag", hash: bareHash("b") });
    const signed = await stores.worker.persistSignedTransaction({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      rawTransaction: encrypted,
      transactionHash: hash("8"),
      at,
    });
    assert.equal(signed.status, "SIGNED");
    await stores.worker.markBroadcastResult({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      result: "BROADCAST",
      at,
    });
    await stores.worker.recordReceipt({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      transactionHash: hash("8"),
      receiptStatus: 1,
      receiptBlockNumber: "12345",
      at,
    });
    const completed = await stores.worker.finalize({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      at,
    });
    const completedJob = stores.inspect.jobs().find((job) => job.id === completed.jobId);
    assert.equal(completedJob?.status, "COMPLETED");
    assert.deepEqual(completedJob?.rawTransaction, encrypted);
    assert.equal(Object.isFrozen(completedJob?.rawTransaction), true);

    const status = await stores.web.status({ capabilityDigest: bareHash("a"), at });
    assert.deepEqual(status, {
      setupIntentId: "setup-production-memory-0001",
      status: "SETUP_COMPLETED",
      predictedAccount: predicted,
      transactionHash: hash("8"),
      createdAt: at,
      updatedAt: at,
      completedAt: at,
    });
    assert.ok(!JSON.stringify(status).includes(signature));
    assert.ok(!JSON.stringify(stores.inspect.events()).includes(signature));
    assert.ok(!JSON.stringify(stores.inspect.events()).includes("ciphertext"));

    await assert.rejects(
      stores.worker.persistSignedTransaction({
        jobId: claimed.jobId,
        fencingToken: claimed.fencingToken,
        rawTransaction: encrypted,
        transactionHash: hash("8"),
        at,
      }),
      (error: unknown) => error instanceof ProductionSetupStoreError && error.code === "SETUP_STATE_CONFLICT",
    );
  });

  it("rejects stale fencing tokens and fences manual review", async () => {
    const stores = await admittedStores();
    const claimed = await stores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(claimed);
    await assert.rejects(
      stores.worker.reserve({
        jobId: claimed.jobId,
        fencingToken: "20000000-0000-4000-8000-000000000000",
        deployerAddress: deployer,
        deployerNonce: "7",
        gasLimit: "1000000",
        nativeCostWei: "1000",
        at,
      }),
      (error: unknown) => error instanceof ProductionSetupStoreError && error.code === "SETUP_FENCE_STALE",
    );
    await stores.worker.markManualReview({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      publicCode: "SETUP_RPC_AMBIGUOUS",
      at,
    });
    const status = await stores.web.status({ capabilityDigest: bareHash("a"), at });
    assert.equal(status.status, "SETUP_MANUAL_REVIEW");
    assert.equal(status.publicCode, "SETUP_RPC_AMBIGUOUS");
    await assert.rejects(
      stores.worker.markBroadcastResult({
        jobId: claimed.jobId,
        fencingToken: claimed.fencingToken,
        result: "BROADCAST",
        at,
      }),
      (error: unknown) => error instanceof ProductionSetupStoreError && error.code === "SETUP_STATE_CONFLICT",
    );
  });

  it("reclaims a persisted signed outbox with identical encrypted bytes after lease expiry", async () => {
    const stores = await admittedStores();
    const claimed = await stores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(claimed);
    assert.equal(claimed.jobStatus, "SIGNING");
    await stores.worker.reserve({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      deployerAddress: deployer,
      deployerNonce: "7",
      gasLimit: "1000000",
      nativeCostWei: "1000",
      at,
    });
    const encrypted = Object.freeze({ ciphertext: "ciphertext", iv: "iv", tag: "tag", hash: bareHash("b") });
    await stores.worker.persistSignedTransaction({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      rawTransaction: encrypted,
      transactionHash: hash("8"),
      at,
    });

    const recovered = await stores.worker.claim({
      workerId: "worker-2",
      at: "2026-07-17T05:02:01.000Z",
      leaseSeconds: 120,
    });
    assert.ok(recovered);
    assert.equal(recovered.jobStatus, "SIGNED");
    assert.equal(recovered.deployerAddress, deployer);
    assert.equal(recovered.deployerNonce, "7");
    assert.equal(recovered.transactionHash, hash("8"));
    assert.deepEqual(recovered.rawTransaction, encrypted);
    assert.notEqual(recovered.fencingToken, claimed.fencingToken);
    await stores.worker.markBroadcastResult({
      jobId: recovered.jobId,
      fencingToken: recovered.fencingToken,
      result: "BROADCAST_UNKNOWN",
      publicCode: "SETUP_RPC_AMBIGUOUS",
      at: "2026-07-17T05:02:01.000Z",
    });
    const unknown = await stores.worker.claim({
      workerId: "worker-3",
      at: "2026-07-17T05:04:02.000Z",
      leaseSeconds: 120,
    });
    assert.equal(unknown?.jobStatus, "BROADCAST_UNKNOWN");
    assert.equal(unknown?.broadcastAt, "2026-07-17T05:02:01.000Z");
  });

  it("records an already-existing exact account without charging sponsor budget", async () => {
    const stores = await admittedStores();
    const claimed = await stores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(claimed);
    const recorded = await stores.worker.recordExistingAccount({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      verificationBlockNumber: "12345",
      at,
    });
    assert.equal(recorded.status, "CONFIRMING");
    const completed = await stores.worker.finalize({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      at,
    });
    assert.equal(completed.accountAddress, predicted);
    assert.equal(stores.inspect.reservations().length, 0);
  });

  it("enforces daily sponsor caps and resets the counter at UTC rollover", async () => {
    const stores = createStores(1);
    const first = challenge();
    const second = challenge({
      setupIntentId: "setup-production-memory-0002",
      capabilityDigest: bareHash("b"),
      ownerAddress: "0x6666666666666666666666666666666666666666",
      predictedAccount: "0x7777777777777777777777777777777777777777",
      deploymentNonce: hash("9"),
      deploymentSalt: hash("a"),
      authorizationHash: hash("b"),
    });
    await stores.web.challenge(first);
    await stores.web.challenge(second);
    await stores.web.admit({ capabilityDigest: first.capabilityDigest, ownerSetupSignature: signature, at });
    await stores.web.admit({ capabilityDigest: second.capabilityDigest, ownerSetupSignature: signature, at });
    const claimOne = await stores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    const claimTwo = await stores.worker.claim({ workerId: "worker-2", at, leaseSeconds: 120 });
    assert.ok(claimOne && claimTwo);
    const reserve = (jobId: string, fencingToken: string, reservationAt: string, nonce: string) =>
      stores.worker.reserve({
        jobId,
        fencingToken,
        deployerAddress: deployer,
        deployerNonce: nonce,
        gasLimit: "1000000",
        nativeCostWei: "1000",
        at: reservationAt,
      });
    await reserve(claimOne.jobId, claimOne.fencingToken, "2026-07-17T23:59:59.000Z", "7");
    await assert.rejects(
      reserve(claimTwo.jobId, claimTwo.fencingToken, "2026-07-17T23:59:59.500Z", "8"),
      (error: unknown) => error instanceof ProductionSetupStoreError && error.code === "SETUP_SPONSOR_CAP",
    );
    const nextDay = await reserve(
      claimTwo.jobId,
      claimTwo.fencingToken,
      "2026-07-18T00:00:00.000Z",
      "8",
    );
    assert.equal(nextDay.disposition, "RESERVED");
  });

  it("fails closed for invalid policy, challenge, admission, claim, and lookup inputs", async () => {
    const policy = {
      deployerAddress: deployer,
      maxDeploymentsPerDay: 10,
      maxGasPerDeployment: 5_000_000n,
      maxNativeCostPerDayWei: 1_000_000_000_000_000_000n,
      maxPending: 4,
    } as const;
    const invalidPolicies = [
      { ...policy, maxDeploymentsPerDay: 0 },
      { ...policy, maxDeploymentsPerDay: 1.5 },
      { ...policy, maxPending: 0 },
      { ...policy, maxPending: 1.5 },
      { ...policy, maxGasPerDeployment: 0n },
      { ...policy, maxNativeCostPerDayWei: 0n },
    ];
    for (const sponsorPolicy of invalidPolicies) {
      assert.throws(
        () => createInMemoryProductionSetupStores({ sponsorPolicy }),
        hasCode("SETUP_SPONSOR_POLICY_INVALID"),
      );
    }

    const invalidChallenges: ProductionSetupChallengeInput[] = [
      challenge({ homeChainId: 195 as 42220 }),
      challenge({ setupIntentId: "short" }),
      challenge({ messageToSign: "" }),
      challenge({ capabilityDigest: "bad" }),
      challenge({ at: "not-a-date" }),
      challenge({ expiresAt: at }),
      challenge({ ownerAddress: "not-an-address" }),
      challenge({ executorAddress: owner }),
      challenge({ deploymentNonce: "0x01" }),
      challenge({ predictedAccount: "not-an-address" }),
    ];
    for (const input of invalidChallenges) {
      const stores = createStores();
      await assert.rejects(
        stores.web.challenge(input),
        hasCode(input.executorAddress === owner ? "SETUP_ACTOR_COLLISION" : "SETUP_INPUT_INVALID"),
      );
    }

    const stores = createStores();
    await stores.web.challenge(challenge());
    const conflicts: Array<Partial<ProductionSetupChallengeInput>> = [
      { setupIntentId: "setup-production-memory-9999" },
      { executorAddress: address("8") },
      { messageToSign: "different typed data" },
      { deploymentNonce: hash("8") },
      { manifestSha256: hash("8") },
      { factoryAddress: address("8") },
      { factoryRuntimeCodeHash: hash("8") },
      { deploymentSalt: hash("8") },
      { predictedAccount: address("8") },
      { accountCreationCodeHash: hash("8") },
      { accountRuntimeCodeHash: hash("8") },
      { authorizationHash: hash("8") },
      { expiresAt: "2026-07-17T05:14:59.000Z" },
    ];
    for (const overrides of conflicts) {
      await assert.rejects(stores.web.challenge(challenge(overrides)), hasCode("SETUP_REPLAY_CONFLICT"));
    }
    await assert.rejects(
      stores.web.challenge(challenge({
        setupIntentId: "setup-production-memory-0002",
        capabilityDigest: bareHash("b"),
        deploymentNonce: hash("8"),
      })),
      hasCode("SETUP_OWNER_BUSY"),
    );
    await assert.rejects(
      stores.web.challenge(challenge({
        setupIntentId: "setup-production-memory-0003",
        capabilityDigest: bareHash("c"),
        ownerAddress: address("8"),
      })),
      hasCode("SETUP_DEPLOYMENT_NONCE_CONFLICT"),
    );
    await assert.rejects(
      stores.web.admit({ capabilityDigest: bareHash("f"), ownerSetupSignature: signature, at }),
      hasCode("SETUP_NOT_FOUND"),
    );
    await assert.rejects(
      stores.web.admit({ capabilityDigest: bareHash("a"), ownerSetupSignature: "bad", at }),
      hasCode("SETUP_INPUT_INVALID"),
    );
    const expiredStores = createStores();
    await expiredStores.web.challenge(challenge());
    await assert.rejects(
      expiredStores.web.admit({
        capabilityDigest: bareHash("a"),
        ownerSetupSignature: signature,
        at: "2026-07-17T05:15:00.000Z",
      }),
      hasCode("SETUP_EXPIRED"),
    );
    assert.equal(
      (await expiredStores.web.status({
        capabilityDigest: bareHash("a"),
        at: "2026-07-17T05:15:00.000Z",
      })).status,
      "SETUP_EXPIRED",
    );
    assert.deepEqual(
      await expiredStores.web.prune({ at: "2026-07-17T05:15:00.000Z" }),
      { expiredSetups: 1, deletedRateBuckets: 0 },
    );
    assert.equal((await expiredStores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 })), null);
    await assert.rejects(
      expiredStores.worker.claim({ workerId: "worker id", at, leaseSeconds: 120 }),
      hasCode("SETUP_INPUT_INVALID"),
    );
    await assert.rejects(
      expiredStores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 14 }),
      hasCode("SETUP_INPUT_INVALID"),
    );
    await assert.rejects(
      expiredStores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 901 }),
      hasCode("SETUP_INPUT_INVALID"),
    );
  });

  it("keeps every worker transition idempotent and rejects conflicting replays", async () => {
    const stores = await admittedStores();
    const claimed = await stores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(claimed);
    const reservation = {
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      deployerAddress: deployer,
      deployerNonce: "7",
      gasLimit: "1000000",
      nativeCostWei: "1000",
      at,
    } as const;
    assert.equal((await stores.worker.reserve(reservation)).disposition, "RESERVED");
    assert.equal((await stores.worker.reserve(reservation)).disposition, "REPLAY");
    await assert.rejects(
      stores.worker.reserve({ ...reservation, nativeCostWei: "1001" }),
      hasCode("SETUP_BUDGET_CONFLICT"),
    );

    const encrypted = Object.freeze({ ciphertext: "ciphertext", iv: "iv", tag: "tag", hash: bareHash("b") });
    const signedInput = {
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      rawTransaction: encrypted,
      transactionHash: hash("8"),
      at,
    } as const;
    assert.equal((await stores.worker.persistSignedTransaction(signedInput)).disposition, "SIGNED");
    assert.equal((await stores.worker.persistSignedTransaction(signedInput)).disposition, "REPLAY");
    await assert.rejects(
      stores.worker.persistSignedTransaction({
        ...signedInput,
        rawTransaction: { ...encrypted, ciphertext: "different" },
      }),
      hasCode("SETUP_OUTBOX_CONFLICT"),
    );

    const broadcastInput = {
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      result: "BROADCAST" as const,
      at,
    };
    assert.equal((await stores.worker.markBroadcastResult(broadcastInput)).disposition, "BROADCAST");
    assert.equal((await stores.worker.markBroadcastResult(broadcastInput)).disposition, "REPLAY");
    await assert.rejects(
      stores.worker.recordReceipt({
        jobId: claimed.jobId,
        fencingToken: claimed.fencingToken,
        transactionHash: hash("9"),
        receiptStatus: 1,
        receiptBlockNumber: "12345",
        at,
      }),
      hasCode("SETUP_TRANSACTION_MISMATCH"),
    );
    const receiptInput = {
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      transactionHash: hash("8"),
      receiptStatus: 1 as const,
      receiptBlockNumber: "12345",
      at,
    };
    assert.equal((await stores.worker.recordReceipt(receiptInput)).disposition, "RECORDED");
    assert.equal((await stores.worker.recordReceipt(receiptInput)).disposition, "REPLAY");
    assert.equal((await stores.worker.finalize({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      at,
    })).disposition, "COMPLETED");
    assert.equal((await stores.worker.finalize({
      jobId: claimed.jobId,
      fencingToken: claimed.fencingToken,
      at,
    })).disposition, "REPLAY");
  });

  it("covers failed receipts, existing-account replay, and manual-review replay", async () => {
    const failedStores = await admittedStores();
    const failedClaim = await failedStores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(failedClaim);
    await failedStores.worker.reserve({
      jobId: failedClaim.jobId, fencingToken: failedClaim.fencingToken, deployerAddress: deployer,
      deployerNonce: "7", gasLimit: "1000000", nativeCostWei: "1000", at,
    });
    const encrypted = Object.freeze({ ciphertext: "ciphertext", iv: "iv", tag: "tag", hash: bareHash("b") });
    await failedStores.worker.persistSignedTransaction({
      jobId: failedClaim.jobId, fencingToken: failedClaim.fencingToken,
      rawTransaction: encrypted, transactionHash: hash("8"), at,
    });
    await failedStores.worker.markBroadcastResult({
      jobId: failedClaim.jobId, fencingToken: failedClaim.fencingToken, result: "BROADCAST_UNKNOWN",
      publicCode: "SETUP_RPC_AMBIGUOUS", at,
    });
    const reverted = {
      jobId: failedClaim.jobId, fencingToken: failedClaim.fencingToken,
      transactionHash: hash("8"), receiptStatus: 0 as const, receiptBlockNumber: "12345", at,
    };
    assert.equal((await failedStores.worker.recordReceipt(reverted)).status, "FAILED");
    assert.equal((await failedStores.worker.recordReceipt(reverted)).disposition, "REPLAY");
    await assert.rejects(
      failedStores.worker.finalize({ jobId: failedClaim.jobId, fencingToken: failedClaim.fencingToken, at }),
      hasCode("SETUP_STATE_CONFLICT"),
    );

    const existingStores = await admittedStores();
    const existingClaim = await existingStores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(existingClaim);
    const existingInput = {
      jobId: existingClaim.jobId,
      fencingToken: existingClaim.fencingToken,
      verificationBlockNumber: "12345",
      at,
    };
    assert.equal((await existingStores.worker.recordExistingAccount(existingInput)).disposition, "RECORDED");
    assert.equal((await existingStores.worker.recordExistingAccount(existingInput)).disposition, "REPLAY");

    const reviewStores = await admittedStores();
    const reviewClaim = await reviewStores.worker.claim({ workerId: "worker-1", at, leaseSeconds: 120 });
    assert.ok(reviewClaim);
    const reviewInput = {
      jobId: reviewClaim.jobId,
      fencingToken: reviewClaim.fencingToken,
      publicCode: "SETUP_RPC_AMBIGUOUS",
      at,
    };
    assert.equal((await reviewStores.worker.markManualReview(reviewInput)).disposition, "MANUAL_REVIEW");
    assert.equal((await reviewStores.worker.markManualReview(reviewInput)).disposition, "REPLAY");
    await assert.rejects(
      reviewStores.worker.markManualReview({ ...reviewInput, publicCode: "SETUP_DIFFERENT" }),
      hasCode("SETUP_STATE_CONFLICT"),
    );
  });
});
