import assert from "node:assert/strict";
import test from "node:test";

import { fromDataSuffix } from "@celo/attribution-tags";
import { ContractFactory } from "ethers";

import {
  assertRemoteCeloMainnetChain,
  buildTaggedFactoryDeploymentData,
  validateFactoryDeploymentInput,
  verifyFactoryTransactionAttribution,
} from "./deploy-celo-factory.ts";

const EXECUTOR = "0x645d39b3943D27cfE53184a446f551a69a4b1FDe";
const OWNER = "0x9CEef6d89915628331C25F48360FfE97CD71B3EE";
const DEPLOYER = "0x72936d76E840ddBB18976705779b6E24834B4d93";
const TAG = "celo_442daeb34ae2";
const ARTIFACT = Object.freeze({
  abi: [{ inputs: [{ internalType: "address", name: "initialExecutor", type: "address" }], stateMutability: "nonpayable", type: "constructor" }],
  bytecode: Object.freeze({ object: "0x60006000f3" }),
});

test("appends the registered ERC-8021 tag without changing factory init data", async () => {
  const result = await buildTaggedFactoryDeploymentData({
    artifact: ARTIFACT,
    executorAddress: EXECUTOR,
    attributionTag: TAG,
  });
  const expected = await new ContractFactory(ARTIFACT.abi, ARTIFACT.bytecode.object)
    .getDeployTransaction(EXECUTOR);

  assert.equal(result.baseData, expected.data);
  assert.equal(result.data.slice(0, -(result.suffix.length - 2)), expected.data);
  assert.deepEqual(fromDataSuffix(result.data), { codes: [TAG], schemaId: 0 });
  assert.ok(Object.isFrozen(result));
});

test("rejects malformed or colliding mainnet actors before deployment", () => {
  assert.deepEqual(validateFactoryDeploymentInput({
    executorAddress: EXECUTOR,
    ownerAddress: OWNER,
    deployerAddress: DEPLOYER,
    attributionTag: TAG,
  }), {
    executorAddress: EXECUTOR,
    ownerAddress: OWNER,
    deployerAddress: DEPLOYER,
    attributionTag: TAG,
  });

  for (const input of [
    { executorAddress: OWNER, ownerAddress: OWNER, deployerAddress: DEPLOYER, attributionTag: TAG },
    { executorAddress: EXECUTOR, ownerAddress: OWNER, deployerAddress: EXECUTOR, attributionTag: TAG },
    { executorAddress: EXECUTOR, ownerAddress: OWNER, deployerAddress: DEPLOYER, attributionTag: "celo_wrong" },
  ]) {
    assert.throws(() => validateFactoryDeploymentInput(input));
  }
});

test("rejects artifacts that cannot produce deployable bytecode", async () => {
  await assert.rejects(() => buildTaggedFactoryDeploymentData({
    artifact: { abi: [], bytecode: { object: "0x" } },
    executorAddress: EXECUTOR,
    attributionTag: TAG,
  }));
});

test("reads the remote RPC chain id instead of trusting a configured static network", async () => {
  const calls: string[] = [];
  const provider = {
    async send(method: string) {
      calls.push(method);
      return "0xa4ec";
    },
  };
  assert.equal(await assertRemoteCeloMainnetChain(provider), 42_220n);
  assert.deepEqual(calls, ["eth_chainId"]);

  await assert.rejects(() => assertRemoteCeloMainnetChain({
    async send() { return "0xaa36a7"; },
  }), /expected 42220/);
  await assert.rejects(() => assertRemoteCeloMainnetChain({
    async send() { return "not-a-chain"; },
  }), /invalid chain id/);
});

test("verifies the confirmed transaction tag through the SDK runtime API", async () => {
  const tagged = await buildTaggedFactoryDeploymentData({
    artifact: ARTIFACT,
    executorAddress: EXECUTOR,
    attributionTag: TAG,
  });
  const result = await verifyFactoryTransactionAttribution({
    hash: `0x${"1".repeat(64)}`,
    attributionTag: TAG,
    async getTransactionData() { return tagged.data; },
  });
  assert.deepEqual(result, { codes: [TAG], schemaId: 0 });

  await assert.rejects(() => verifyFactoryTransactionAttribution({
    hash: `0x${"2".repeat(64)}`,
    attributionTag: TAG,
    async getTransactionData() { return tagged.baseData; },
  }), /missing the registered/);
});
