import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packagePaths = ["packages/skill", "packages/shared", "apps/mcp-server", "apps/setup-web", "packages/cli"];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

async function main() {
  const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const packDir = await mkdtemp(join(tmpdir(), "agentpay-release-pack-"));
  const appDir = await mkdtemp(join(tmpdir(), "agentpay-release-app-"));
  const installDir = await mkdtemp(join(tmpdir(), "agentpay-release-install-"));
  const selfHostedInstallDir = await mkdtemp(join(tmpdir(), "agentpay-release-self-hosted-"));
  const codexHomeDir = await mkdtemp(join(tmpdir(), "agentpay-release-codex-home-"));
  const claudeHomeDir = await mkdtemp(join(tmpdir(), "agentpay-release-claude-home-"));
  const claudeInstallDir = await mkdtemp(join(tmpdir(), "agentpay-release-claude-install-"));
  const cursorHomeDir = await mkdtemp(join(tmpdir(), "agentpay-release-cursor-home-"));
  const cursorInstallDir = await mkdtemp(join(tmpdir(), "agentpay-release-cursor-install-"));
  const hermesHomeDir = await mkdtemp(join(tmpdir(), "agentpay-release-hermes-home-"));
  const hermesInstallDir = await mkdtemp(join(tmpdir(), "agentpay-release-hermes-install-"));
  const codexHomeEnv = {
    ...createHomeEnv(codexHomeDir),
    CODEX_HOME: join(codexHomeDir, ".codex"),
  };
  const claudeHomeEnv = createHomeEnv(claudeHomeDir);
  const cursorHomeEnv = createHomeEnv(cursorHomeDir);
  const hermesHomeEnv = createHomeEnv(hermesHomeDir);

  try {
    const tarballs = packagePaths.map((packagePath) =>
      packPackage({
        rootDir,
        packagePath,
        packDir,
      }),
    );

    run(npmCommand, ["init", "-y"], { cwd: appDir, quiet: true });
    await mkdir(join(appDir, ".codex"));
    await mkdir(codexHomeEnv.CODEX_HOME, { recursive: true });
    await mkdir(join(codexHomeDir, ".agentpay"), { recursive: true });
    await writeFile(
      join(codexHomeEnv.CODEX_HOME, "config.toml"),
      [
        "[mcp_servers.agentpay]",
        'url = "https://wallet.agentpay.site/mcp"',
        "",
        "[mcp_servers.agentpay.oauth]",
        'client_id = "existing-x-layer-client"',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(codexHomeDir, ".agentpay", "x-layer-sentinel"), "untouched\n", "utf8");
    run(npmCommand, ["install", "--ignore-scripts", ...tarballs], { cwd: appDir, quiet: true });
    run(
      npxCommand,
      ["@agentpay-ai/agentpay-celo", "install", "--runtime", "codex", "--output-dir", installDir],
      {
        cwd: appDir,
        env: codexHomeEnv,
      },
    );
    run(
      npxCommand,
      ["@agentpay-ai/agentpay-celo", "install", "--runtime", "generic", "--self-hosted", "--output-dir", selfHostedInstallDir],
      {
        cwd: appDir,
      },
    );
    run(npxCommand, ["@agentpay-ai/agentpay-celo", "install", "--runtime", "claude", "--output-dir", claudeInstallDir], {
      cwd: appDir,
      env: claudeHomeEnv,
    });
    run(npxCommand, ["@agentpay-ai/agentpay-celo", "install", "--runtime", "cursor", "--output-dir", cursorInstallDir], {
      cwd: appDir,
      env: cursorHomeEnv,
    });
    run(npxCommand, ["@agentpay-ai/agentpay-celo", "install", "--runtime", "hermes", "--output-dir", hermesInstallDir], {
      cwd: appDir,
      env: hermesHomeEnv,
    });
    run(npxCommand, ["@agentpay-ai/agentpay-celo", "doctor"], {
      cwd: appDir,
      env: {
        AGENTPAY_CONFIG: join(selfHostedInstallDir, "config.json"),
        SUPABASE_URL: "https://agentpay.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
        CELO_RPC_URL: "https://rpc.example",
        EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`,
        SETUP_DEPLOYER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
      },
    });

    await access(join(installDir, "runtimes", "codex", "AGENTS.md"));
    await access(join(installDir, "runtimes", "codex", "mcp.json"));
    await access(join(installDir, "skills", "agentpay-celo", "SKILL.md"));
    await access(join(installDir, "skills", "agentpay-celo", "agents", "openai.yaml"));
    await access(join(codexHomeDir, ".agents", "skills", "agentpay-celo", "SKILL.md"));
    if ((await readFile(join(codexHomeDir, ".agentpay", "x-layer-sentinel"), "utf8")) !== "untouched\n") {
      throw new Error("Codex install changed the existing X Layer AgentPay state.");
    }
    const codexConfig = await readFile(join(codexHomeEnv.CODEX_HOME, "config.toml"), "utf8");
    if (!/\[mcp_servers\.agentpay\][\s\S]*url = "https:\/\/wallet\.agentpay\.site\/mcp"/.test(codexConfig)) {
      throw new Error("Codex install removed the existing X Layer AgentPay MCP entry.");
    }
    if (!/\[mcp_servers\.agentpay-celo\][\s\S]*url = "https:\/\/wallet\.agentpay\.site\/celo\/mcp"/.test(codexConfig)) {
      throw new Error("Codex install did not register the isolated Celo MCP entry.");
    }
    const mcpConfig = JSON.parse(await readFile(join(installDir, "runtimes", "codex", "mcp.json"), "utf8"));
    if (mcpConfig.mcpServers?.["agentpay-celo"]?.url !== "https://wallet.agentpay.site/celo/mcp") {
      throw new Error("Default AgentPay install did not use the hosted MCP URL.");
    }
    const claudeConfig = JSON.parse(await readFile(getClaudeDesktopConfigPath(claudeHomeEnv), "utf8"));
    if (claudeConfig.mcpServers?.["agentpay-celo"]?.url !== "https://wallet.agentpay.site/celo/mcp") {
      throw new Error("Claude install did not register the hosted AgentPay MCP URL.");
    }
    const cursorConfig = JSON.parse(await readFile(join(cursorHomeDir, ".cursor", "mcp.json"), "utf8"));
    if (cursorConfig.mcpServers?.["agentpay-celo"]?.url !== "https://wallet.agentpay.site/celo/mcp") {
      throw new Error("Cursor install did not register the hosted AgentPay MCP URL.");
    }
    const hermesConfig = await readFile(join(hermesHomeDir, ".hermes", "config.yaml"), "utf8");
    if (!/agentpay-celo:[\s\S]*url: "https:\/\/wallet\.agentpay\.site\/celo\/mcp"/.test(hermesConfig)) {
      throw new Error("Hermes install did not register the hosted AgentPay MCP URL.");
    }
    const packagedBytecode = await readFile(join(selfHostedInstallDir, "AgentPayAccount.bin"), "utf8");
    for (const selector of ["9cc1e242", "7b3f2401", "83e988c1", "7882731c"]) {
      if (!packagedBytecode.toLowerCase().includes(selector)) {
        throw new Error(`Packaged AgentPayAccount.bin is missing AgentPayAccountV2 selector ${selector}.`);
      }
    }
    const selfHostedConfigPath = join(selfHostedInstallDir, "config.json");
    await access(selfHostedConfigPath);
    const selfHostedMcpConfig = JSON.parse(
      await readFile(join(selfHostedInstallDir, "runtimes", "generic", "mcp.json"), "utf8"),
    );
    const generatedServer = selfHostedMcpConfig.mcpServers?.["agentpay-celo"];
    if (
      generatedServer?.command !== "npx"
      || !Array.isArray(generatedServer.args)
      || generatedServer.env?.AGENTPAY_CONFIG !== selfHostedConfigPath
    ) {
      throw new Error("Self-hosted install did not generate a runnable isolated MCP command.");
    }
    await runMcpHandshake(
      process.platform === "win32" ? "npx.cmd" : generatedServer.command,
      generatedServer.args,
      {
        cwd: appDir,
        env: {
          ...generatedServer.env,
          SUPABASE_URL: "https://agentpay.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
          CELO_RPC_URL: "https://rpc.example",
          EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`,
        },
      },
    );
    console.log("AgentPay release smoke passed.");
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(appDir, { recursive: true, force: true });
    await rm(installDir, { recursive: true, force: true });
    await rm(selfHostedInstallDir, { recursive: true, force: true });
    await rm(codexHomeDir, { recursive: true, force: true });
    await rm(claudeHomeDir, { recursive: true, force: true });
    await rm(claudeInstallDir, { recursive: true, force: true });
    await rm(cursorHomeDir, { recursive: true, force: true });
    await rm(cursorInstallDir, { recursive: true, force: true });
    await rm(hermesHomeDir, { recursive: true, force: true });
    await rm(hermesInstallDir, { recursive: true, force: true });
  }
}

function packPackage({ rootDir, packagePath, packDir }) {
  const result = run(npmCommand, ["pack", `./${packagePath}`, "--pack-destination", packDir], {
    cwd: rootDir,
    quiet: true,
  });
  const tarballName = result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!tarballName) {
    throw new Error(`npm pack did not return a tarball name for ${packagePath}.`);
  }

  return join(packDir, tarballName);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
  });

  if (!options.quiet && result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (!options.quiet && result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}.\n${output}`);
  }

  return result;
}

async function runMcpHandshake(command, args, options) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stderr = "";
    let initialized = false;
    let settled = false;
    let forceCloseTimer;
    const timeout = setTimeout(() => {
      fail(new Error(`Generated self-hosted MCP command timed out.\n${stderr}`));
    }, 10_000);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          fail(new Error(`Generated self-hosted MCP command emitted non-JSON stdout: ${line}`));
          return;
        }
        if (message?.id !== 1) continue;
        if (!isValidInitializeResult(message)) {
          fail(new Error(`Generated self-hosted MCP command returned an invalid initialize response: ${line}`));
          return;
        }
        initialized = true;
        child.stdin.end();
        forceCloseTimer = setTimeout(() => child.kill("SIGTERM"), 1_000);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      fail(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      if (!initialized) {
        settled = true;
        rejectPromise(
          new Error(
            `Generated self-hosted MCP command exited before initialize (code ${code}, signal ${signal}).\n${stderr}`,
          ),
        );
        return;
      }
      settled = true;
      resolvePromise();
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "agentpay-release-smoke",
            version: "1.0.0",
          },
        },
      })}\n`,
    );

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      child.kill("SIGTERM");
      rejectPromise(error);
    }
  });
}

function isValidInitializeResult(message) {
  return (
    message?.jsonrpc === "2.0"
    && message.id === 1
    && message.error === undefined
    && typeof message.result?.protocolVersion === "string"
    && typeof message.result?.capabilities === "object"
    && message.result.capabilities !== null
    && !Array.isArray(message.result.capabilities)
    && typeof message.result?.serverInfo?.name === "string"
    && typeof message.result?.serverInfo?.version === "string"
  );
}

function createHomeEnv(homeDir) {
  return {
    HOME: homeDir,
    APPDATA: join(homeDir, "AppData", "Roaming"),
    XDG_CONFIG_HOME: join(homeDir, ".config"),
  };
}

function getClaudeDesktopConfigPath(env) {
  if (process.platform === "win32") {
    return join(env.APPDATA, "Claude", "claude_desktop_config.json");
  }

  if (process.platform === "darwin") {
    return join(env.HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }

  return join(env.XDG_CONFIG_HOME, "Claude", "claude_desktop_config.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "AgentPay release smoke failed.");
  process.exitCode = 1;
});
