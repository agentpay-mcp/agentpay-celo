import { createHmac, randomBytes } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const SETUP_ROLES = new Set(["agentpay_setup_web", "agentpay_setup_worker"]);
const MIN_TOKEN_LIFETIME_SECONDS = 900;
const MAX_TOKEN_LIFETIME_SECONDS = 7_200;
const DEFAULT_TOKEN_TTL_SECONDS = 6_900;
const TOKEN_FILE_MODE = 0o640;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function assertSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative safe integer.`);
}

function assertSigningMaterial(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32 || /[\r\n]/u.test(secret)) {
    throw new Error("Setup JWT signing material is invalid.");
  }
}

export function createSetupScopedJwt({ secret, role, issuedAt, expiresAt } = {}) {
  assertSigningMaterial(secret);
  if (!SETUP_ROLES.has(role)) throw new Error("Unsupported setup JWT role.");
  assertSafeInteger(issuedAt, "issuedAt");
  assertSafeInteger(expiresAt, "expiresAt");
  const lifetime = expiresAt - issuedAt;
  if (lifetime < MIN_TOKEN_LIFETIME_SECONDS || lifetime > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error("Setup JWT lifetime is outside the allowed window.");
  }
  const encodedHeader = encode({ alg: "HS256", typ: "JWT" });
  const encodedPayload = encode({ iss: "supabase", role, iat: issuedAt, exp: expiresAt });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export async function rotateSetupTokenFiles({
  secret,
  webTokenPath,
  workerTokenPath,
  webUid,
  webGid,
  workerUid,
  workerGid,
  expectedDirectoryUid = 0,
  nowSeconds = Math.floor(Date.now() / 1_000),
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  renameFile = rename,
} = {}) {
  assertSigningMaterial(secret);
  assertSafeInteger(nowSeconds, "nowSeconds");
  assertSafeInteger(ttlSeconds, "ttlSeconds");
  if (ttlSeconds < MIN_TOKEN_LIFETIME_SECONDS || ttlSeconds > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error("Setup JWT lifetime is outside the allowed window.");
  }
  if (typeof renameFile !== "function") throw new Error("Setup JWT rename operation is invalid.");
  assertTokenPath(webTokenPath, "webTokenPath");
  assertTokenPath(workerTokenPath, "workerTokenPath");
  if (webTokenPath === workerTokenPath) throw new Error("Setup JWT token paths must be distinct.");
  for (const [name, value] of Object.entries({
    webUid,
    webGid,
    workerUid,
    workerGid,
    expectedDirectoryUid,
  })) assertSafeInteger(value, name);

  const directories = [...new Set([dirname(webTokenPath), dirname(workerTokenPath)])];
  await Promise.all(directories.map((directory) => assertPrivateDirectory(directory, expectedDirectoryUid)));
  await Promise.all([assertSafeTarget(webTokenPath), assertSafeTarget(workerTokenPath)]);

  const issuedAt = nowSeconds;
  const expiresAt = issuedAt + ttlSeconds;
  const webToken = createSetupScopedJwt({ secret, role: "agentpay_setup_web", issuedAt, expiresAt });
  const workerToken = createSetupScopedJwt({ secret, role: "agentpay_setup_worker", issuedAt, expiresAt });
  const staged = [];
  const backups = [];
  try {
    staged.push(await stageTokenFile(webTokenPath, webToken, webUid, webGid));
    staged.push(await stageTokenFile(workerTokenPath, workerToken, workerUid, workerGid));
    await Promise.all([assertSafeTarget(webTokenPath), assertSafeTarget(workerTokenPath)]);
    backups.push(await backupExistingTarget(webTokenPath, renameFile));
    backups.push(await backupExistingTarget(workerTokenPath, renameFile));
    await renameFile(staged[0].path, webTokenPath);
    staged[0].installed = true;
    await renameFile(staged[1].path, workerTokenPath);
    staged[1].installed = true;
    await Promise.all(directories.map(syncDirectory));
  } catch (error) {
    try {
      await rollbackTokenPair({
        targets: [webTokenPath, workerTokenPath],
        staged,
        backups,
        renameFile,
        directories,
      });
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Setup JWT rotation and rollback failed.");
    }
    throw error;
  } finally {
    await Promise.all(staged.filter((entry) => !entry.installed).map((entry) => rm(entry.path, { force: true })));
  }
  await Promise.all(backups.filter(Boolean).map((entry) => rm(entry.path, { force: true })));
  await Promise.all(directories.map(syncDirectory));
  return Object.freeze({ issuedAt, expiresAt });
}

function assertTokenPath(path, name) {
  if (typeof path !== "string" || !isAbsolute(path) || basename(path).length === 0 || /[\r\n]/u.test(path)) {
    throw new Error(`${name} must be an absolute file path.`);
  }
}

async function assertPrivateDirectory(path, expectedUid) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Setup JWT parent path must be a real private directory, not a symbolic link.");
  }
  if (await realpath(path) !== path || metadata.uid !== expectedUid || (metadata.mode & 0o022) !== 0) {
    throw new Error("Setup JWT parent directory ownership or mode is unsafe.");
  }
}

async function assertSafeTarget(path) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("Setup JWT target must not be a symbolic link.");
    if (!metadata.isFile()) throw new Error("Setup JWT target must be a regular file.");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
}

async function backupExistingTarget(targetPath, renameFile) {
  try {
    const metadata = await lstat(targetPath);
    if (metadata.isSymbolicLink()) throw new Error("Setup JWT target must not be a symbolic link.");
    if (!metadata.isFile()) throw new Error("Setup JWT target must be a regular file.");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
  const backupPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomBytes(8).toString("hex")}.rollback`,
  );
  await renameFile(targetPath, backupPath);
  return { path: backupPath, restored: false };
}

async function rollbackTokenPair({ targets, staged, backups, renameFile, directories }) {
  const rollbackErrors = [];
  for (let index = 0; index < targets.length; index += 1) {
    try {
      if (staged[index]?.installed) {
        await rm(targets[index], { force: true });
        staged[index].installed = false;
      }
      const backup = backups[index];
      if (backup) {
        await renameFile(backup.path, targets[index]);
        backup.restored = true;
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  try {
    await Promise.all(directories.map(syncDirectory));
  } catch (error) {
    rollbackErrors.push(error);
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(rollbackErrors, "Setup JWT token pair rollback failed.");
  }
}

async function stageTokenFile(targetPath, token, uid, gid) {
  const stagePath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  const noFollow = fileConstants.O_NOFOLLOW ?? 0;
  const handle = await open(
    stagePath,
    fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_WRONLY | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(`${token}\n`, "utf8");
    await handle.sync();
    await handle.chmod(TOKEN_FILE_MODE);
    await handle.chown(uid, gid);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(stagePath, { force: true });
    throw error;
  }
  await handle.close();
  return { path: stagePath, installed: false };
}

async function syncDirectory(path) {
  const handle = await open(path, fileConstants.O_RDONLY | (fileConstants.O_DIRECTORY ?? 0));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function readPositiveEnvironmentInteger(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer.`);
  return parsed;
}

async function main() {
  const result = await rotateSetupTokenFiles({
    secret: process.env.AGENTPAY_SETUP_JWT_SECRET,
    webTokenPath: process.env.AGENTPAY_SETUP_WEB_TOKEN_PATH,
    workerTokenPath: process.env.AGENTPAY_SETUP_WORKER_TOKEN_PATH,
    webUid: readPositiveEnvironmentInteger("AGENTPAY_SETUP_WEB_UID"),
    webGid: readPositiveEnvironmentInteger("AGENTPAY_SETUP_WEB_GID"),
    workerUid: readPositiveEnvironmentInteger("AGENTPAY_SETUP_WORKER_UID"),
    workerGid: readPositiveEnvironmentInteger("AGENTPAY_SETUP_WORKER_GID"),
    ttlSeconds: readPositiveEnvironmentInteger("AGENTPAY_SETUP_JWT_TTL_SECONDS"),
  });
  process.stdout.write(`${JSON.stringify({ status: "ROTATED", expiresAt: result.expiresAt })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Setup JWT token rotation failed.");
    process.exitCode = 1;
  });
}
