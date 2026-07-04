import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAgentPayConfig,
  installAgentPay,
  loadAgentPayConfigEnv,
  parseCliArgs,
  runAgentPayDoctor,
  runAgentPayCli,
} from "./index.ts";

const cliFixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("parseCliArgs", () => {
  it("parses install runtime, output directory, and force flag", () => {
    assert.deepEqual(parseCliArgs(["install", "--runtime", "codex", "--output-dir", "/tmp/agentpay", "--force"]), {
      command: "install",
      runtime: "codex",
      outputDir: "/tmp/agentpay",
      force: true,
    });
  });

  it("parses mcp command", () => {
    assert.deepEqual(parseCliArgs(["mcp"]), {
      command: "mcp",
    });
  });

  it("parses doctor command", () => {
    assert.deepEqual(parseCliArgs(["doctor"]), {
      command: "doctor",
    });
  });

  it("parses setup-web command", () => {
    assert.deepEqual(parseCliArgs(["setup-web"]), {
      command: "setup-web",
    });
  });
});

describe("installAgentPay", () => {
  it("writes config and runtime templates into the output directory", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "agentpay-cli-"));

    try {
      const result = await installAgentPay({
        runtime: "codex",
        outputDir,
        packageRoot: process.cwd(),
      });

      const config = JSON.parse(await readFile(join(outputDir, "config.json"), "utf8"));
      const bytecodePath = join(outputDir, "AgentPayAccount.bin");
      const bytecode = await readFile(bytecodePath, "utf8");
      const mcpConfig = JSON.parse(await readFile(join(outputDir, "runtimes", "codex", "mcp.json"), "utf8"));
      const instructions = await readFile(join(outputDir, "runtimes", "codex", "AGENTS.md"), "utf8");
      const skill = await readFile(join(outputDir, "skills", "agentpay", "SKILL.md"), "utf8");
      const skillMetadata = await readFile(join(outputDir, "skills", "agentpay", "agents", "openai.yaml"), "utf8");

      assert.deepEqual(
        config,
        createAgentPayConfig({
          accountBytecodePath: bytecodePath,
        }),
      );
      assert.equal("SETUP_DEPLOYER_PRIVATE_KEY" in config, true);
      assert.equal("AGENTPAY_OWNER_ADDRESS" in config, true);
      assert.equal("AGENTPAY_EXECUTOR_ADDRESS" in config, true);
      assert.equal(config.AGENTPAY_ACCOUNT_BYTECODE_PATH, bytecodePath);
      assert.match(bytecode, /^0x[a-fA-F0-9]{200,}\n$/);
      assert.match(skill, /Requires exact chat approval before execution/);
      assert.match(skillMetadata, /display_name: AgentPay/);
      assert.equal("AGENTPAY_INITIAL_ROUTE_TARGETS" in config, true);
      assert.equal("SETUP_WEB_PORT" in config, true);
      assert.equal(mcpConfig.mcpServers.agentpay.command, "npx");
      assert.deepEqual(mcpConfig.mcpServers.agentpay.args, ["-y", "@agentpay-ai/agentpay", "mcp"]);
      assert.match(instructions, /return to the agent chat/i);
      assert.match(instructions, /prepare_wallet_creation/);
      assert.match(instructions, /check_wallet_creation/);
      assert.match(instructions, /Never call `execute_payment`/);
      assert.match(instructions, /call `track_payment`/);
      assert.deepEqual(result.writtenFiles.sort(), [
        join(outputDir, "AgentPayAccount.bin"),
        join(outputDir, "config.json"),
        join(outputDir, "runtimes", "codex", "AGENTS.md"),
        join(outputDir, "runtimes", "codex", "mcp.json"),
        join(outputDir, "skills", "agentpay", "SKILL.md"),
        join(outputDir, "skills", "agentpay", "agents", "openai.yaml"),
      ].sort());
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("keeps critical payment safety instructions in every runtime template", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "agentpay-cli-"));
    const runtimes = ["codex", "claude", "cursor", "generic", "hermes"] as const;
    const instructionFiles = {
      codex: "AGENTS.md",
      claude: "CLAUDE.md",
      cursor: "rules.md",
      generic: "instructions.md",
      hermes: "instructions.md",
    } as const;

    try {
      for (const runtime of runtimes) {
        await installAgentPay({
          runtime,
          outputDir: join(outputDir, runtime),
          packageRoot: process.cwd(),
        });

        const instructions = await readFile(
          join(outputDir, runtime, "runtimes", runtime, instructionFiles[runtime]),
          "utf8",
        );

        assert.match(instructions, /return to the agent chat/i, runtime);
        assert.match(instructions, /setup signature.*not payment approval/i, runtime);
        assert.match(instructions, /prepare_wallet_creation/, runtime);
        assert.match(instructions, /check_wallet_creation/, runtime);
        assert.match(instructions, /doctor.*diagnostic|diagnostic.*doctor/i, runtime);
        assert.match(instructions, /setup-web.*fallback|fallback.*setup-web/i, runtime);
        assert.match(instructions, /AgentPayAccount\.bin/, runtime);
        assert.match(instructions, /parse_invoice_payment/, runtime);
        assert.match(instructions, /parse_x402_payment_required/, runtime);
        assert.match(instructions, /check_route_target_allowance/, runtime);
        assert.match(instructions, /prepare_route_target_allowance/, runtime);
        assert.match(instructions, /exact approval phrase/i, runtime);
        assert.match(instructions, /track_payment/, runtime);
        assert.match(instructions, /list_payment_events/, runtime);
        assert.match(instructions, /raw RPC calls?|manual (?:wallet )?transfers?|private[- ]key handling/i, runtime);
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite existing files unless force is enabled", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "agentpay-cli-"));

    try {
      await installAgentPay({ runtime: "generic", outputDir, packageRoot: process.cwd() });
      await assert.rejects(
        () => installAgentPay({ runtime: "generic", outputDir, packageRoot: process.cwd() }),
        /already exists/,
      );

      const forced = await installAgentPay({ runtime: "generic", outputDir, packageRoot: process.cwd(), force: true });

      assert.ok(forced.writtenFiles.includes(join(outputDir, "config.json")));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("installs from a published package root without a workspace packages/cli path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agentpay-cli-published-"));
    const packageRoot = join(tempDir, "agentpay");
    const outputDir = join(tempDir, "install");

    try {
      await mkdir(join(packageRoot, "assets"), { recursive: true });
      await mkdir(join(packageRoot, "templates", "generic"), { recursive: true });
      await copyFile(
        join(cliFixtureRoot, "assets", "AgentPayAccount.bin"),
        join(packageRoot, "assets", "AgentPayAccount.bin"),
      );
      await copyFile(
        join(cliFixtureRoot, "templates", "generic", "instructions.md"),
        join(packageRoot, "templates", "generic", "instructions.md"),
      );
      await copyFile(
        join(cliFixtureRoot, "templates", "generic", "mcp.json"),
        join(packageRoot, "templates", "generic", "mcp.json"),
      );

      const result = await installAgentPay({
        runtime: "generic",
        outputDir,
        packageRoot,
      });

      const config = JSON.parse(await readFile(join(outputDir, "config.json"), "utf8"));
      const bytecode = await readFile(join(outputDir, "AgentPayAccount.bin"), "utf8");

      assert.equal(config.AGENTPAY_ACCOUNT_BYTECODE_PATH, join(outputDir, "AgentPayAccount.bin"));
      assert.match(bytecode, /^0x[a-fA-F0-9]{200,}\n$/);
      assert.ok(result.writtenFiles.includes(join(outputDir, "runtimes", "generic", "instructions.md")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("loadAgentPayConfigEnv", () => {
  it("merges AGENTPAY_CONFIG JSON with process env values", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "agentpay-cli-"));
    const configPath = join(outputDir, "config.json");

    try {
      await writeFile(
        configPath,
        JSON.stringify(
          {
            SUPABASE_URL: "https://agentpay.supabase.co",
            BNB_RPC_URL: "https://rpc.example",
            EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`,
          },
          null,
          2,
        ),
      );

      const env = await loadAgentPayConfigEnv({
        AGENTPAY_CONFIG: configPath,
        SUPABASE_SERVICE_ROLE_KEY: "env-service-key",
      });

      assert.equal(env.SUPABASE_URL, "https://agentpay.supabase.co");
      assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "env-service-key");
      assert.equal(env.BNB_RPC_URL, "https://rpc.example");
      assert.equal(env.EXECUTOR_PRIVATE_KEY, `0x${"1".repeat(64)}`);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

describe("runAgentPayDoctor", () => {
  it("reports missing MCP runtime keys without leaking configured secrets", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "agentpay-cli-"));
    const configPath = join(outputDir, "config.json");

    try {
      await writeFile(
        configPath,
        JSON.stringify(
          {
            SUPABASE_URL: "https://agentpay.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
            BNB_RPC_URL: "",
            EXECUTOR_PRIVATE_KEY: "",
          },
          null,
          2,
        ),
      );

      const report = await runAgentPayDoctor({
        AGENTPAY_CONFIG: configPath,
      });

      assert.equal(report.ok, false);
      assert.deepEqual(report.mcp.missing, ["BNB_RPC_URL", "EXECUTOR_PRIVATE_KEY"]);
      assert.match(report.text, /MCP runtime: missing BNB_RPC_URL, EXECUTOR_PRIVATE_KEY/);
      assert.doesNotMatch(report.text, /service-role-secret/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("reports MCP and setup readiness when required keys are present", async () => {
    const report = await runAgentPayDoctor({
      SUPABASE_URL: "https://agentpay.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      BNB_RPC_URL: "https://rpc.example",
      EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`,
      SETUP_DEPLOYER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
      AGENTPAY_ACCOUNT_BYTECODE: "0x6000",
      AGENTPAY_INITIAL_ROUTE_TARGETS: "0x7777777777777777777777777777777777777777",
    });

    assert.equal(report.ok, true);
    assert.equal(report.mcp.status, "ready");
    assert.equal(report.setup.status, "ready");
    assert.match(report.text, /MCP runtime: ready/);
    assert.match(report.text, /Setup web: ready/);
    assert.doesNotMatch(report.text, /service-role-secret/);
    assert.doesNotMatch(report.text, new RegExp(`0x${"1".repeat(64)}`));
  });
});

describe("runAgentPayCli", () => {
  it("detects the target runtime from project markers when install omits --runtime", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agentpay-cli-detect-"));
    const projectDir = join(tempDir, "project");
    const outputDir = join(tempDir, "install");
    const originalCwd = process.cwd();
    let installedRuntime: string | undefined;

    try {
      await mkdir(join(projectDir, ".codex"), { recursive: true });
      process.chdir(projectDir);

      const exitCode = await runAgentPayCli(["install", "--output-dir", outputDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        install: async (options) => {
          installedRuntime = options.runtime;
          return {
            outputDir: options.outputDir,
            runtime: options.runtime,
            writtenFiles: [],
          };
        },
      });

      assert.equal(exitCode, 0);
      assert.equal(installedRuntime, "codex");
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("starts the MCP server with config-aware env", async () => {
    const startedEnvs: Array<Record<string, string | undefined>> = [];
    const exitCode = await runAgentPayCli(["mcp"], {
      env: {
        SUPABASE_URL: "https://agentpay.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        BNB_RPC_URL: "https://rpc.example",
        EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`,
      },
      async startMcpServer(options) {
        startedEnvs.push(options.env as Record<string, string | undefined>);
      },
      stdout() {},
      stderr() {},
    });

    assert.equal(exitCode, 0);
    assert.equal(startedEnvs.length, 1);
    assert.equal(startedEnvs[0].SUPABASE_URL, "https://agentpay.supabase.co");
  });

  it("prints doctor results and exits non-zero when required config is missing", async () => {
    const stdoutLines: string[] = [];
    const exitCode = await runAgentPayCli(["doctor"], {
      env: {
        SUPABASE_URL: "https://agentpay.supabase.co",
      },
      stdout(message) {
        stdoutLines.push(message);
      },
      stderr() {},
    });

    assert.equal(exitCode, 1);
    assert.match(stdoutLines.join("\n"), /MCP runtime: missing/);
  });

  it("starts setup web with config-aware env", async () => {
    const stdoutLines: string[] = [];
    const started: Array<{ port?: number }> = [];
    const exitCode = await runAgentPayCli(["setup-web"], {
      env: {
        SUPABASE_URL: "https://agentpay.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        BNB_RPC_URL: "https://rpc.example",
        SETUP_DEPLOYER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
        AGENTPAY_ACCOUNT_BYTECODE: "0x6000",
        SETUP_WEB_PORT: "3333",
      },
      async startSetupWebServer(_dependencies, options) {
        started.push({ port: options?.port });
        return {
          url: "http://127.0.0.1:3333/setup",
          async close() {},
        };
      },
      stdout(message) {
        stdoutLines.push(message);
      },
      stderr() {},
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(started, [{ port: 3333 }]);
    assert.match(stdoutLines.join("\n"), /AgentPay setup web listening at http:\/\/127\.0\.0\.1:3333\/setup/);
  });
});
