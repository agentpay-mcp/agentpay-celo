import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Interface } from "ethers";

import { checkRouteTargetAllowance, prepareRouteTargetAllowance } from "./route-target-allowance.ts";

const accountInterface = new Interface(["function setAllowedRouteTarget(address target,bool allowed)"]);

describe("checkRouteTargetAllowance", () => {
  it("reads route target allowlist status for the active wallet", async () => {
    const checks: unknown[] = [];
    const output = await checkRouteTargetAllowance(
      {
        routeTarget: "0x7777777777777777777777777777777777777777",
      },
      {
        wallets: {
          async getActiveWallet() {
            return {
              ownerAddress: "0x2222222222222222222222222222222222222222",
              accountAddress: "0x3333333333333333333333333333333333333333",
              homeChainId: 42220,
              executorAddress: "0x4444444444444444444444444444444444444444",
              status: "ACTIVE",
            };
          },
        },
        routeTargetAllowances: {
          async isRouteTargetAllowed(request) {
            checks.push(request);
            return true;
          },
        },
      },
    );

    assert.deepEqual(checks, [
      {
        accountAddress: "0x3333333333333333333333333333333333333333",
        chainId: 42220,
        routeTarget: "0x7777777777777777777777777777777777777777",
      },
    ]);
    assert.deepEqual(output, {
      status: "ACTIVE",
      routeTarget: "0x7777777777777777777777777777777777777777",
      routeTargetAllowed: true,
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accountAddress: "0x3333333333333333333333333333333333333333",
      chainId: 42220,
      chain: "Celo",
      instructionToAgent:
        "Route target 0x7777777777777777777777777777777777777777 is already allowlisted on Celo.",
    });
  });

  it("returns NOT_CREATED when checking without an active wallet", async () => {
    const output = await checkRouteTargetAllowance(
      {
        routeTarget: "0x7777777777777777777777777777777777777777",
      },
      {
        wallets: {
          async getActiveWallet() {
            return null;
          },
        },
        routeTargetAllowances: {
          async isRouteTargetAllowed() {
            throw new Error("isRouteTargetAllowed was not expected.");
          },
        },
      },
    );

    assert.deepEqual(output, {
      status: "NOT_CREATED",
      routeTarget: "0x7777777777777777777777777777777777777777",
      routeTargetAllowed: null,
      instructionToAgent: "Create an AgentPay wallet before checking route target allowlist status.",
    });
  });
});

describe("prepareRouteTargetAllowance", () => {
  it("returns the owner transaction for allowing a LI.FI route target", async () => {
    const output = await prepareRouteTargetAllowance(
      {
        routeTarget: "0x7777777777777777777777777777777777777777",
      },
      {
        wallets: {
          async getActiveWallet() {
            return {
              ownerAddress: "0x2222222222222222222222222222222222222222",
              accountAddress: "0x3333333333333333333333333333333333333333",
              homeChainId: 42220,
              executorAddress: "0x4444444444444444444444444444444444444444",
              status: "ACTIVE",
            };
          },
        },
      },
    );

    assert.deepEqual(output, {
      status: "READY",
      action: "ALLOW",
      routeTarget: "0x7777777777777777777777777777777777777777",
      allowed: true,
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accountAddress: "0x3333333333333333333333333333333333333333",
      chainId: 42220,
      chain: "Celo",
      transaction: {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x3333333333333333333333333333333333333333",
        value: "0",
        chainId: 42220,
        data: accountInterface.encodeFunctionData("setAllowedRouteTarget", [
          "0x7777777777777777777777777777777777777777",
          true,
        ]),
      },
      instructionToAgent:
        "Ask the owner wallet 0x2222222222222222222222222222222222222222 to submit this transaction on Celo. It allows route target 0x7777777777777777777777777777777777777777 and does not approve any payment.",
    });
  });

  it("can prepare a revoke transaction", async () => {
    const output = await prepareRouteTargetAllowance(
      {
        routeTarget: "0x7777777777777777777777777777777777777777",
        allowed: false,
      },
      {
        wallets: {
          async getActiveWallet() {
            return {
              ownerAddress: "0x2222222222222222222222222222222222222222",
              accountAddress: "0x3333333333333333333333333333333333333333",
              homeChainId: 42220,
              executorAddress: "0x4444444444444444444444444444444444444444",
              status: "ACTIVE",
            };
          },
        },
      },
    );

    assert.equal(output.action, "REVOKE");
    assert.equal(output.allowed, false);
    assert.equal(
      output.transaction?.data,
      accountInterface.encodeFunctionData("setAllowedRouteTarget", [
        "0x7777777777777777777777777777777777777777",
        false,
      ]),
    );
  });

  it("returns NOT_CREATED when there is no active wallet", async () => {
    const output = await prepareRouteTargetAllowance(
      {
        routeTarget: "0x7777777777777777777777777777777777777777",
      },
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
      action: "ALLOW",
      routeTarget: "0x7777777777777777777777777777777777777777",
      allowed: true,
      transaction: null,
      instructionToAgent: "Create an AgentPay wallet before preparing a route target allowlist transaction.",
    });
  });
});
