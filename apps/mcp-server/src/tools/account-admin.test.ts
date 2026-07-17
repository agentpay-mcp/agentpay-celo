import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Interface } from "ethers";

import { prepareAccountAdminTransaction } from "./account-admin.ts";

const accountAdminInterface = new Interface([
  "function pause()",
  "function setExecutor(address newExecutor)",
]);

describe("prepareAccountAdminTransaction", () => {
  it("returns the owner transaction for pausing the account", async () => {
    const output = await prepareAccountAdminTransaction(
      { action: "PAUSE" },
      {
        wallets: {
          async getActiveWallet() {
            return activeWallet();
          },
        },
      },
    );

    assert.deepEqual(output, {
      status: "READY",
      action: "PAUSE",
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accountAddress: "0x3333333333333333333333333333333333333333",
      chainId: 42220,
      chain: "Celo",
      transaction: {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x3333333333333333333333333333333333333333",
        value: "0",
        chainId: 42220,
        data: accountAdminInterface.encodeFunctionData("pause"),
      },
      instructionToAgent:
        "Ask the owner wallet 0x2222222222222222222222222222222222222222 to submit this PAUSE transaction on Celo. This is an owner admin action and does not approve any payment.",
    });
  });

  it("encodes executor rotation", async () => {
    const output = await prepareAccountAdminTransaction(
      {
        action: "SET_EXECUTOR",
        newExecutorAddress: "0x5555555555555555555555555555555555555555",
      },
      {
        wallets: {
          async getActiveWallet() {
            return activeWallet();
          },
        },
      },
    );

    assert.equal(
      output.transaction?.data,
      accountAdminInterface.encodeFunctionData("setExecutor", ["0x5555555555555555555555555555555555555555"]),
    );
  });

  it("returns NOT_CREATED without an active wallet", async () => {
    const output = await prepareAccountAdminTransaction(
      { action: "UNPAUSE" },
      {
        wallets: {
          async getActiveWallet() {
            return null;
          },
        },
      },
    );

    assert.deepEqual(output, {
      status: "NOT_CREATED",
      action: "UNPAUSE",
      transaction: null,
      instructionToAgent: "Create an AgentPay wallet before preparing an account admin transaction.",
    });
  });
});

function activeWallet() {
  return {
    ownerAddress: "0x2222222222222222222222222222222222222222",
    accountAddress: "0x3333333333333333333333333333333333333333",
    homeChainId: 42220,
    executorAddress: "0x4444444444444444444444444444444444444444",
    status: "ACTIVE" as const,
  };
}
