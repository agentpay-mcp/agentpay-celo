import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const artifactUrl = new URL("../ops/deployments/celo-mainnet-canary-funding.json", import.meta.url);
const addressPattern = /^0x[a-f0-9]{40}$/;
const txHashPattern = /^0x[a-f0-9]{64}$/;

describe("Celo mainnet canary funding evidence", () => {
  it("records bounded funding transactions without signing material", async () => {
    const raw = await readFile(artifactUrl, "utf8");
    const artifact = JSON.parse(raw) as Record<string, any>;

    assert.equal(artifact.chainId, 42220);
    assert.equal(artifact.asset.address, "0xceba9300f2b948710d2653dd7b07f33a8b32118c");
    assert.equal(artifact.asset.decimals, 6);
    assert.doesNotMatch(
      raw,
      /private.?key|mnemonic|seed.?phrase|raw.?transaction|api.?key|service.?role|bearer|password|secret/i,
    );

    const actors = [
      artifact.sponsor,
      artifact.smartAccount,
      artifact.payer,
      artifact.executor,
    ];
    assert.equal(new Set(actors).size, actors.length);
    for (const actor of actors) assert.match(actor, addressPattern);

    assert.equal(artifact.swap.amountInCelo, "2.0");
    assert.ok(Number(artifact.swap.minOutUsdc) >= 0.14);
    assert.ok(Number(artifact.swap.receivedUsdc) >= Number(artifact.swap.minOutUsdc));
    assert.equal(artifact.swap.remainingAllowanceCelo, "0.0");

    const distributed = artifact.distributions.reduce(
      (total: bigint, distribution: Record<string, string>) => total + BigInt(distribution.amountAtomic),
      0n,
    );
    const distributionsByRole = Object.fromEntries(
      artifact.distributions.map((distribution: Record<string, string>) => [distribution.role, distribution]),
    );
    assert.deepEqual(Object.keys(distributionsByRole).sort(), ["canary_payer", "smart_account"]);
    assert.equal(distributionsByRole.smart_account.recipient, artifact.smartAccount);
    assert.equal(distributionsByRole.canary_payer.recipient, artifact.payer);
    assert.match(distributionsByRole.smart_account.txHash, txHashPattern);
    assert.match(distributionsByRole.canary_payer.txHash, txHashPattern);
    assert.equal(distributed, 100_000n);
    assert.ok(distributed <= BigInt(artifact.swap.receivedAtomic));
    assert.equal(artifact.finalBalances.smartAccountUsdc, "0.05");
    assert.equal(artifact.finalBalances.payerUsdc, "0.05");
    assert.ok(Number(artifact.finalBalances.sponsorCelo) >= 1);
    assert.equal(artifact.finalBalances.executorCelo, "2.0");

    const transactionsByRole = Object.fromEntries(
      artifact.transactions.map((transaction: Record<string, unknown>) => [transaction.role, transaction]),
    );
    assert.equal(
      transactionsByRole.smart_account_funding.txHash,
      distributionsByRole.smart_account.txHash,
    );
    assert.equal(
      transactionsByRole.canary_payer_funding.txHash,
      distributionsByRole.canary_payer.txHash,
    );

    for (const transaction of artifact.transactions) {
      assert.match(transaction.txHash, txHashPattern);
      assert.equal(transaction.status, 1);
      assert.ok(Number.isInteger(transaction.blockNumber) && transaction.blockNumber > 0);
      assert.match(transaction.confirmedAt, /^2026-\d{2}-\d{2}T/);
    }
  });
});
