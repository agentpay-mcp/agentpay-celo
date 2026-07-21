import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { keccak256 } from "ethers";

import {
  bindRuntimeOwner,
  exportAgentPayAccountBytecode,
  extractAgentPayAccountBytecode,
  extractAgentPayAccountV2RuntimeArtifact,
} from "./export-agentpay-bytecode.mjs";

const creationBytecode = "0x60006000";
const runtimeBytecode = `0x${"11".repeat(4)}${"00".repeat(32)}${"22".repeat(4)}`;

function foundryArtifact(overrides = {}) {
  return {
    bytecode: { object: creationBytecode },
    deployedBytecode: {
      object: runtimeBytecode,
      immutableReferences: { "2277": [{ start: 4, length: 32 }] },
    },
    ...overrides,
  };
}

describe("extractAgentPayAccountBytecode", () => {
  it("reads deploy bytecode from a Foundry artifact", () => {
    assert.equal(
      extractAgentPayAccountBytecode({
        bytecode: {
          object: "0x60006000",
        },
      }),
      "0x60006000",
    );
  });

  it("rejects missing or invalid deploy bytecode", () => {
    assert.throws(() => extractAgentPayAccountBytecode({ bytecode: { object: "" } }), /deploy bytecode/);
    assert.throws(() => extractAgentPayAccountBytecode({ bytecode: { object: "6000" } }), /deploy bytecode/);
    assert.throws(() => extractAgentPayAccountBytecode({ bytecode: { object: "0x123" } }), /deploy bytecode/);
  });
});

describe("exportAgentPayAccountBytecode", () => {
  it("writes deploy bytecode and a validated runtime template", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-bytecode-export-"));

    try {
      const artifactPath = join(dir, "AgentPayAccount.json");
      const outputPath = join(dir, "AgentPayAccount.bin");
      const runtimeOutputPath = join(dir, "AgentPayAccountV2.runtime.json");
      await writeFile(artifactPath, JSON.stringify(foundryArtifact()), "utf8");

      const result = await exportAgentPayAccountBytecode({ artifactPath, outputPath, runtimeOutputPath });

      assert.deepEqual(result, {
        artifactPath,
        outputPath,
        runtimeOutputPath,
        bytecodeBytes: 4,
        bytecodeHash: "0x5e3ce470a8506d55e59815db7232a08774174ae0c7fdb2fbc81a49e4e242b0d6",
        runtimeBytecodeBytes: 40,
        runtimeTemplateHash: keccak256(runtimeBytecode),
      });
      assert.equal(await readFile(outputPath, "utf8"), "0x60006000\n");
      assert.deepEqual(JSON.parse(await readFile(runtimeOutputPath, "utf8")), {
        bytecode: runtimeBytecode,
        immutableReferences: [{ start: 16, length: 20 }],
        creationCodeHash: keccak256(creationBytecode),
        runtimeTemplateHash: keccak256(runtimeBytecode),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("AgentPayAccountV2 runtime artifact", () => {
  it("normalizes Foundry immutable address slots and binds only owner bytes", () => {
    const artifact = extractAgentPayAccountV2RuntimeArtifact(foundryArtifact());
    const owner = `0x${"ab".repeat(20)}`;
    const expectedBytecode = `0x${"11".repeat(4)}${"00".repeat(12)}${"ab".repeat(20)}${"22".repeat(4)}`;

    assert.deepEqual(artifact, {
      bytecode: runtimeBytecode,
      immutableReferences: [{ start: 16, length: 20 }],
      creationCodeHash: keccak256(creationBytecode),
      runtimeTemplateHash: keccak256(runtimeBytecode),
    });
    assert.deepEqual(bindRuntimeOwner(artifact, owner), {
      bytecode: expectedBytecode,
      runtimeCodeHash: keccak256(expectedBytecode),
    });
    assert.equal(artifact.bytecode, runtimeBytecode);
  });

  it("rejects malformed immutable slots, owners, and pre-bound templates", () => {
    assert.throws(
      () =>
        extractAgentPayAccountV2RuntimeArtifact(
          foundryArtifact({
            bytecode: { object: creationBytecode },
            deployedBytecode: {
              object: runtimeBytecode,
              immutableReferences: { "2277": [{ start: 4, length: 31 }] },
            },
          }),
        ),
      /immutable reference/i,
    );

    const artifact = extractAgentPayAccountV2RuntimeArtifact(foundryArtifact());
    assert.throws(() => bindRuntimeOwner(artifact, "0x1234"), /owner/i);
    const prebound = structuredClone(artifact);
    prebound.bytecode = `0x${"11".repeat(4)}${"00".repeat(12)}${"ab".repeat(20)}${"22".repeat(4)}`;
    assert.throws(() => bindRuntimeOwner(prebound, `0x${"cd".repeat(20)}`), /template/i);
  });
});
