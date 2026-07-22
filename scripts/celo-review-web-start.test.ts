import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  assertCeloReviewArtifacts,
  parseCeloReviewWebEnvironment,
} from "./celo-review-web-start.ts";

const commit = "a".repeat(40);

function reviewEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    AGENTPAY_ENVIRONMENT: "production",
    AGENTPAY_HOME_CHAIN_ID: "42220",
    AGENTPAY_ACCOUNT_VERSION: "v2",
    AGENTPAY_EXECUTION_MODE: "OFF",
    AGENTPAY_A2MCP_PAYMENT_ENABLED: "false",
    AGENTPAY_SETUP_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    SUPABASE_PRODUCTION_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: "service-role-key",
    AGENTPAY_REVIEW_TOKEN_SECRET: "r".repeat(64),
    SETUP_WEB_URL: "https://wallet.agentpay.site/celo/review",
    AGENTPAY_MAINNET_MANIFEST_PATH: "/opt/agentpay-celo/manifest.json",
    AGENTPAY_REVIEW_MANIFEST_SHA256: "b".repeat(64),
    AGENTPAY_RELEASE_COMMIT: commit,
    ...overrides,
  };
}

describe("parseCeloReviewWebEnvironment", () => {
  it("accepts the minimal production review boundary", () => {
    const result = parseCeloReviewWebEnvironment(reviewEnv());
    assert.equal(result.projectRef, "abcdefghijklmnopqrst");
    assert.equal(result.reviewUrl, "https://wallet.agentpay.site/celo/review");
  });

  it("rejects executor-grade secrets and non-Celo review URLs", () => {
    assert.throws(
      () => parseCeloReviewWebEnvironment(reviewEnv({ EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}` })),
      /over-privileged/,
    );
    assert.throws(
      () => parseCeloReviewWebEnvironment(reviewEnv({ SETUP_WEB_URL: "https://wallet.agentpay.site/review" })),
      /incomplete/,
    );
    assert.throws(
      () => parseCeloReviewWebEnvironment(reviewEnv({
        AGENTPAY_SETUP_DEPLOYER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
      })),
      /over-privileged/,
    );
    assert.throws(
      () => parseCeloReviewWebEnvironment(reviewEnv({
        AGENTPAY_SETUP_RAW_TX_ENCRYPTION_KEY: "c".repeat(64),
      })),
      /over-privileged/,
    );
  });
});

describe("assertCeloReviewArtifacts", () => {
  it("pins the immutable release directory and canonical manifest digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentpay-celo-review-"));
    const releaseRoot = join(root, commit);
    await mkdir(releaseRoot);
    const manifest = { z: 1, a: { enabled: false } };
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const canonical = '{"a":{"enabled":false},"z":1}';
    const environment = parseCeloReviewWebEnvironment(reviewEnv({
      AGENTPAY_MAINNET_MANIFEST_PATH: manifestPath,
      AGENTPAY_REVIEW_MANIFEST_SHA256: createHash("sha256").update(canonical).digest("hex"),
    }));

    assert.doesNotThrow(() => assertCeloReviewArtifacts({ releaseRoot, environment }));
    assert.throws(
      () => assertCeloReviewArtifacts({ releaseRoot: join(root, "b".repeat(40)), environment }),
      /pinned commit/,
    );
  });
});
