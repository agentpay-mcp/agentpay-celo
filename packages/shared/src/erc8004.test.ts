import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AGENTPAY_ERC8004_METADATA_URL,
  CELO_MAINNET_AGENT_REGISTRY,
  CELO_MAINNET_IDENTITY_REGISTRY,
  CELO_MAINNET_REPUTATION_REGISTRY,
  agentPayErc8004RegistrationSchema,
  createAgentPayErc8004Registration,
} from "./erc8004.ts";

const agentWallet = "0x1234567890abcdef1234567890abcdef12345678";

describe("AgentPay ERC-8004 registration metadata", () => {
  it("builds honest bootstrap metadata around the live AgentPay endpoints", () => {
    const metadata = createAgentPayErc8004Registration({ agentWalletAddress: agentWallet });

    assert.equal(AGENTPAY_ERC8004_METADATA_URL, "https://wallet.agentpay.site/.well-known/agent-registration.json");
    assert.equal(CELO_MAINNET_IDENTITY_REGISTRY, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
    assert.equal(CELO_MAINNET_REPUTATION_REGISTRY, "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
    assert.equal(CELO_MAINNET_AGENT_REGISTRY, `eip155:42220:${CELO_MAINNET_IDENTITY_REGISTRY}`);
    assert.deepEqual(metadata, {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "AgentPay",
      description:
        "Owner-authorized stablecoin payment agent for direct payments, invoices, remittance routes, and x402 services on Celo, with guarded contract-call preparation.",
      image: "https://www.agentpay.site/agentpay-logo/agentpay-icon-192.png",
      services: [
        { name: "web", endpoint: "https://www.agentpay.site/" },
        { name: "MCP", endpoint: "https://mcp.agentpay.site/celo/mcp", version: "2025-06-18" },
        { name: "wallet", endpoint: `eip155:42220:${agentWallet}` },
      ],
      x402Support: true,
      active: true,
      registrations: [],
    });
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(Object.isFrozen(metadata.services), true);
  });

  it("adds the exact Celo registration only after a real agent id is supplied", () => {
    const metadata = createAgentPayErc8004Registration({
      agentWalletAddress: agentWallet,
      agentId: 42,
    });

    assert.deepEqual(metadata.registrations, [{ agentId: 42, agentRegistry: CELO_MAINNET_AGENT_REGISTRY }]);
    assert.deepEqual(agentPayErc8004RegistrationSchema.parse(metadata), metadata);
  });

  it("rejects fake wallets, unsafe ids, unverified trust claims, and non-production endpoints", () => {
    for (const invalidWallet of [
      "0x0000000000000000000000000000000000000000",
      "0x1234",
      "0xZZ34567890abcdef1234567890abcdef12345678",
    ]) {
      assert.throws(
        () => createAgentPayErc8004Registration({ agentWalletAddress: invalidWallet }),
        /ERC-8004/i,
      );
    }
    for (const agentId of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => createAgentPayErc8004Registration({ agentWalletAddress: agentWallet, agentId }),
        /ERC-8004/i,
      );
    }

    const valid = createAgentPayErc8004Registration({ agentWalletAddress: agentWallet });
    assert.equal(agentPayErc8004RegistrationSchema.safeParse({
      ...valid,
      image: "http://localhost:3000/agent.png",
    }).success, false);
    assert.equal(agentPayErc8004RegistrationSchema.safeParse({
      ...valid,
      supportedTrust: ["reputation"],
    }).success, false);
    assert.equal(agentPayErc8004RegistrationSchema.safeParse({
      ...valid,
      services: valid.services.map((service) => service.name === "MCP"
        ? { ...service, endpoint: "https://wallet.agentpay.site/celo/mcp" }
        : service),
    }).success, false);
  });
});
