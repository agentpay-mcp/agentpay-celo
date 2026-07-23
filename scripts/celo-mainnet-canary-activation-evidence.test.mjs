import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const evidencePath = new URL(
  "../ops/deployments/celo-mainnet-canary-activation.json",
  import.meta.url,
);

describe("Celo mainnet canary activation evidence", () => {
  it("pins the live READY/CANARY release, challenge, boundaries, and zero-use ledger", async () => {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));

    assert.equal(evidence.kind, "agentpay-celo-mainnet-canary-activation-evidence");
    assert.deepEqual(evidence.mcpAndReviewRelease, {
      commit: "16b284cb9b307f918cea68ce12e7b7d955b60b5c",
      services: [
        "agentpay-celo-mcp-public.service",
        "agentpay-celo-mcp-consumer.service",
        "agentpay-celo-review.service",
      ],
    });
    assert.deepEqual(evidence.manifest, {
      canonicalSha256: "86a3546debc08603877cd2365742eb5305b94ada43a6c085f41b4495c81d4189",
      rawSha256: "89c59aeae01597b29226c9642b348f8cabf1b58faada9eee8ea14efb4738f247",
      deployedPath: "/opt/agentpay-celo/manifests/celo-mainnet.canary.86a3546d.json",
    });
    assert.equal(evidence.readiness.httpStatus, 200);
    assert.equal(evidence.readiness.code, "READY");
    assert.equal(evidence.readiness.mode, "CANARY");
    assert.equal(evidence.readiness.status, "READY");
    assert.deepEqual(evidence.readiness.checks, {
      environment: true,
      manifest: true,
      identity: true,
      payment: true,
      rawTransactionEncryption: true,
      account: true,
      canaryAdmission: true,
      onboardingMode: true,
      onboarding: true,
    });

    assert.deepEqual(evidence.x402Challenge, {
      httpStatus: 402,
      x402Version: 2,
      resourceUrl: "https://mcp.agentpay.site/celo/mcp",
      network: "eip155:42220",
      scheme: "exact",
      amountAtomic: "10000",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      payTo: "0xA495Eaff5809Efb32beb6eCd18a48e9469Acf121",
      maxTimeoutSeconds: 300,
      assetTransferMethod: "eip3009",
    });
    assert.deepEqual(evidence.boundaries, {
      healthHttpStatus: 200,
      consumerMcpHttpStatus: 401,
      reviewHttpStatus: 200,
      setupHttpStatus: 200,
      setupMode: "CANARY",
    });
    assert.deepEqual(evidence.canaryLedger, {
      acceptedLifecycles: 0,
      tenantDailyAtomic: 0,
      globalDailyAtomic: 0,
      tenantInFlight: 0,
    });
    assert.deepEqual(evidence.verificationActions, {
      paymentRequestSent: false,
      onchainTransactionSubmitted: false,
    });
    assert.deepEqual(
      evidence.services.map((service) => service.name),
      [
        "agentpay-celo-mcp-public.service",
        "agentpay-celo-mcp-consumer.service",
        "agentpay-celo-review.service",
      ],
    );
    for (const service of evidence.services) {
      assert.equal(service.activeState, "active");
      assert.equal(service.restarts, 0);
      assert.equal(
        service.workingDirectory,
        "/opt/agentpay-celo/releases/16b284cb9b307f918cea68ce12e7b7d955b60b5c",
      );
    }
  });

  it("contains no secret-bearing keys or values", async () => {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    const serialized = JSON.stringify(evidence);
    const visit = (value, path = "evidence") => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) {
          assert.doesNotMatch(
            key,
            /private.?key|service.?role|api.?key|signing.?key|encryption.?key|password|credential|secret|mnemonic|seed.?phrase|bearer|token|raw.?transaction.?(?:bytes|hex)|jwt/i,
          );
          visit(entry, `${path}.${key}`);
        }
        return;
      }
      if (typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)) {
        assert.match(path, /\.(canonicalSha256|rawSha256)$/);
      }
    };

    visit(evidence);

    assert.doesNotMatch(serialized, /CELO-FW2U3|bearer\s+|seed phrase|mnemonic|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/i);
    assert.doesNotMatch(serialized, /CELO-FW2U3|0x[a-f0-9]{64}/i);
  });
});
