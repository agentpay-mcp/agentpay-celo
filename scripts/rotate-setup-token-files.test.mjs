import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, lstat, mkdir, readFile, realpath, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createSetupScopedJwt,
  rotateSetupTokenFiles,
} from "./rotate-setup-token-files.mjs";

const signingMaterialFixture = "x".repeat(48);

function decodeJwt(token) {
  const [header, payload, signature] = token.split(".");
  return {
    encodedHeader: header,
    encodedPayload: payload,
    header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    signature: Buffer.from(signature, "base64url"),
  };
}

describe("Celo setup token file rotation", () => {
  it("creates a bounded Supabase HS256 token for exactly one setup role", () => {
    const token = createSetupScopedJwt({
      secret: signingMaterialFixture,
      role: "agentpay_setup_web",
      issuedAt: 1_000,
      expiresAt: 7_900,
    });
    const decoded = decodeJwt(token);
    const expectedSignature = createHmac("sha256", signingMaterialFixture)
      .update(`${decoded.encodedHeader}.${decoded.encodedPayload}`)
      .digest();

    assert.deepEqual(decoded.header, { alg: "HS256", typ: "JWT" });
    assert.deepEqual(decoded.payload, {
      iss: "supabase",
      role: "agentpay_setup_web",
      iat: 1_000,
      exp: 7_900,
    });
    assert.equal(timingSafeEqual(decoded.signature, expectedSignature), true);
  });

  it("atomically writes distinct role tokens with private ownership and mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentpay-celo-jwt-"));
    const privateDirectory = join(await realpath(root), "private");
    await mkdir(privateDirectory, { mode: 0o700 });
    const webTokenPath = join(privateDirectory, "onboarding-web.jwt");
    const workerTokenPath = join(privateDirectory, "setup-worker.jwt");
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;

    const result = await rotateSetupTokenFiles({
      secret: signingMaterialFixture,
      webTokenPath,
      workerTokenPath,
      webUid: uid,
      webGid: gid,
      workerUid: uid,
      workerGid: gid,
      expectedDirectoryUid: uid,
      nowSeconds: 2_000,
      ttlSeconds: 6_900,
    });

    const [webToken, workerToken, webMetadata, workerMetadata] = await Promise.all([
      readFile(webTokenPath, "utf8"),
      readFile(workerTokenPath, "utf8"),
      lstat(webTokenPath),
      lstat(workerTokenPath),
    ]);
    assert.notEqual(webToken, workerToken);
    assert.equal(decodeJwt(webToken.trim()).payload.role, "agentpay_setup_web");
    assert.equal(decodeJwt(workerToken.trim()).payload.role, "agentpay_setup_worker");
    assert.equal(webMetadata.mode & 0o777, 0o640);
    assert.equal(workerMetadata.mode & 0o777, 0o640);
    assert.equal(webMetadata.uid, uid);
    assert.equal(workerMetadata.uid, uid);
    assert.deepEqual(result, { issuedAt: 2_000, expiresAt: 8_900 });
  });

  it("restores both previous tokens when the second installation rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentpay-celo-jwt-rollback-"));
    const privateDirectory = join(await realpath(root), "private");
    await mkdir(privateDirectory, { mode: 0o700 });
    const webTokenPath = join(privateDirectory, "onboarding-web.jwt");
    const workerTokenPath = join(privateDirectory, "setup-worker.jwt");
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    const base = {
      secret: signingMaterialFixture,
      webTokenPath,
      workerTokenPath,
      webUid: uid,
      webGid: gid,
      workerUid: uid,
      workerGid: gid,
      expectedDirectoryUid: uid,
      ttlSeconds: 6_900,
    };
    await rotateSetupTokenFiles({ ...base, nowSeconds: 1_000 });
    const previous = await Promise.all([readFile(webTokenPath, "utf8"), readFile(workerTokenPath, "utf8")]);
    let renameCount = 0;
    const failSecondInstall = async (source, target) => {
      renameCount += 1;
      if (renameCount === 4) throw new Error("injected second install failure");
      return rename(source, target);
    };

    await assert.rejects(
      rotateSetupTokenFiles({ ...base, nowSeconds: 2_000, renameFile: failSecondInstall }),
      /injected second install failure/,
    );
    assert.deepEqual(
      await Promise.all([readFile(webTokenPath, "utf8"), readFile(workerTokenPath, "utf8")]),
      previous,
    );
  });

  it("rejects weak signing material, unsafe lifetimes, paths, and existing symlinks", async () => {
    assert.throws(
      () => createSetupScopedJwt({ secret: "x".repeat(8), role: "agentpay_setup_web", issuedAt: 0, expiresAt: 1_000 }),
      /signing material/i,
    );
    assert.throws(
      () => createSetupScopedJwt({ secret: signingMaterialFixture, role: "service_role", issuedAt: 0, expiresAt: 1_000 }),
      /role/i,
    );
    assert.throws(
      () => createSetupScopedJwt({ secret: signingMaterialFixture, role: "agentpay_setup_worker", issuedAt: 0, expiresAt: 8_000 }),
      /lifetime/i,
    );

    const root = await mkdtemp(join(tmpdir(), "agentpay-celo-jwt-symlink-"));
    const privateDirectory = join(await realpath(root), "private");
    await mkdir(privateDirectory, { mode: 0o700 });
    const webTokenPath = join(privateDirectory, "onboarding-web.jwt");
    const workerTokenPath = join(privateDirectory, "setup-worker.jwt");
    await symlink(join(privateDirectory, "missing"), webTokenPath);
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    await assert.rejects(
      rotateSetupTokenFiles({
        secret: signingMaterialFixture,
        webTokenPath,
        workerTokenPath,
        webUid: uid,
        webGid: gid,
        workerUid: uid,
        workerGid: gid,
        expectedDirectoryUid: uid,
        nowSeconds: 2_000,
        ttlSeconds: 6_900,
      }),
      /symbolic link/i,
    );

    const unsafeDirectory = join(await realpath(root), "unsafe");
    await mkdir(unsafeDirectory, { mode: 0o700 });
    await chmod(unsafeDirectory, 0o770);
    await assert.rejects(
      rotateSetupTokenFiles({
        secret: signingMaterialFixture,
        webTokenPath: join(unsafeDirectory, "web.jwt"),
        workerTokenPath: join(unsafeDirectory, "worker.jwt"),
        webUid: uid,
        webGid: gid,
        workerUid: uid,
        workerGid: gid,
        expectedDirectoryUid: uid,
        nowSeconds: 2_000,
        ttlSeconds: 6_900,
      }),
      /ownership or mode is unsafe/i,
    );
    await chmod(unsafeDirectory, 0o700);
    await assert.rejects(
      rotateSetupTokenFiles({
        secret: signingMaterialFixture,
        webTokenPath: join(unsafeDirectory, "web.jwt"),
        workerTokenPath: join(unsafeDirectory, "worker.jwt"),
        webUid: uid,
        webGid: gid,
        workerUid: uid,
        workerGid: gid,
        expectedDirectoryUid: uid + 1,
        nowSeconds: 2_000,
        ttlSeconds: 6_900,
      }),
      /ownership or mode is unsafe/i,
    );

    const aliasDirectory = join(await realpath(root), "private-alias");
    await symlink(privateDirectory, aliasDirectory);
    await assert.rejects(
      rotateSetupTokenFiles({
        secret: signingMaterialFixture,
        webTokenPath: join(aliasDirectory, "web.jwt"),
        workerTokenPath: join(aliasDirectory, "worker.jwt"),
        webUid: uid,
        webGid: gid,
        workerUid: uid,
        workerGid: gid,
        expectedDirectoryUid: uid,
        nowSeconds: 2_000,
        ttlSeconds: 6_900,
      }),
      /symbolic link/i,
    );
  });
});
