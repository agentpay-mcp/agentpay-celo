#!/usr/bin/env node
import { constants as fsConstants, existsSync } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  startAgentPayHttpServer,
  startAgentPayMcpServer,
  type AgentPayHttpServer,
  type StartAgentPayHttpServerOptions,
  type StartAgentPayMcpServerOptions,
} from "@agentpay-ai/mcp-server-celo";
import {
  createSetupWebDependencies,
  parseSetupWebEnv,
  startSetupWebServer,
  type SetupWebDependencies,
} from "@agentpay-ai/setup-web-celo";

import {
  AGENTPAY_MCP_SERVER_NAME,
  AGENTPAY_SKILL_NAME,
  assertWritable,
  createAgentPayMcpConfig,
  findPackageRoot,
  getRuntimeTemplateFiles,
  isMcpConfigTemplateFile,
  prepareNativeRuntimeConfigUpdate,
  resolveAgentPaySkillRoot,
  resolveCliPackageRoot,
} from "./installer-support.ts";

const runtimeNames = ["codex", "claude", "cursor", "generic", "hermes"] as const;
const DEFAULT_HOSTED_MCP_URL = "https://wallet.agentpay.site/celo/mcp";
const DEFAULT_INSTALL_DIR = "~/.agentpay-celo";
const requiredConfigKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CELO_RPC_URL", "EXECUTOR_PRIVATE_KEY"] as const;
const setupRequiredConfigKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CELO_RPC_URL",
  "SETUP_DEPLOYER_PRIVATE_KEY",
] as const;
const optionalConfigKeys = [
  "BASE_RPC_URL",
  "CELO_MAINNET_RPC_URL",
  "CELO_MAINNET_RPC_FALLBACK_URL",
  "CELO_SEPOLIA_RPC_URL",
  "SETUP_WEB_URL",
  "LIFI_API_KEY",
  "LIFI_BASE_URL",
  "SETUP_DEPLOYER_PRIVATE_KEY",
  "AGENTPAY_OWNER_ADDRESS",
  "AGENTPAY_EXECUTOR_ADDRESS",
  "AGENTPAY_HOME_CHAIN_ID",
  "AGENTPAY_CONSUMER_MCP_URL",
  "AGENTPAY_PAID_MCP_URL",
  "AGENTPAY_PUBLIC_SETUP_URL",
  "AGENTPAY_PUBLIC_REVIEW_URL",
  "AGENTPAY_HTTP_MODE",
  "AGENTPAY_ENVIRONMENT",
  "AGENTPAY_MAINNET_MANIFEST_PATH",
  "AGENTPAY_SESSION_HASH_KEY",
  "AGENTPAY_REVIEW_TOKEN_SECRET",
  "AGENTPAY_ACCOUNT_ADDRESS",
  "AGENTPAY_CELO_USDC_ADDRESS",
  "AGENTPAY_CELO_USDT_ADDRESS",
  "AGENTPAY_CELO_USDM_ADDRESS",
  "AGENTPAY_CELO_SEPOLIA_USDC_ADDRESS",
  "AGENTPAY_CELO_SEPOLIA_USDT_ADDRESS",
  "AGENTPAY_CELO_SEPOLIA_USDM_ADDRESS",
  "AGENTPAY_ACCOUNT_BYTECODE_PATH",
  "AGENTPAY_ACCOUNT_BYTECODE",
  "AGENTPAY_ACCOUNT_VERSION",
  "AGENTPAY_ACCOUNT_BYTECODE_HASH",
  "AGENTPAY_INITIAL_ROUTE_TARGETS",
  "SETUP_WEB_PORT",
  "X402_BAZAAR_FACILITATOR_URL",
  "AGENTPAY_A2MCP_PAYMENT_ENABLED",
  "AGENTPAY_A2MCP_PAYMENT_PAY_TO",
  "AGENTPAY_A2MCP_PAYMENT_PRICE",
  "AGENTPAY_A2MCP_PAYMENT_NETWORK",
  "AGENTPAY_A2MCP_PAYMENT_ASSET",
  "AGENTPAY_A2MCP_PAYMENT_MAX_TIMEOUT_SECONDS",
  "AGENTPAY_A2MCP_PAYMENT_ASSET_DECIMALS",
  "AGENTPAY_A2MCP_PAYMENT_SYNC_SETTLE",
  "AGENTPAY_A2MCP_PAYMENT_ASSET_TRANSFER_METHOD",
  "AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL",
  "AGENTPAY_CELO_X402_API_KEY",
] as const;
const privateKeyPattern = /^0x[a-fA-F0-9]{64}$/;
const hexDataPattern = /^0x(?:[a-fA-F0-9]{2})+$/;
const bytes32Pattern = /^0x[a-fA-F0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export type AgentPayRuntimeName = (typeof runtimeNames)[number];

export type AgentPayCliCommand =
  | {
      command: "install";
      runtime: AgentPayRuntimeName | undefined;
      outputDir: string;
      force: boolean;
      selfHosted: boolean;
      mcpUrl: string;
    }
  | { command: "mcp" }
  | { command: "serve-http"; hostname: string; port: number }
  | { command: "setup-web" }
  | { command: "doctor" }
  | { command: "help" };

export interface InstallAgentPayOptions {
  runtime: AgentPayRuntimeName;
  outputDir: string;
  packageRoot?: string;
  force?: boolean;
  selfHosted?: boolean;
  mcpUrl?: string;
  installNativeRuntimeConfig?: boolean;
  codexConfigPath?: string;
  agentSkillsRoot?: string;
  claudeDesktopConfigPath?: string;
  cursorMcpConfigPath?: string;
  hermesConfigPath?: string;
  skillRoot?: string;
}

export interface InstallAgentPayResult {
  outputDir: string;
  runtime: AgentPayRuntimeName;
  writtenFiles: string[];
}

export interface RunAgentPayCliDependencies {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  startMcpServer?: (options: StartAgentPayMcpServerOptions) => Promise<void>;
  startHttpServer?: (options: StartAgentPayHttpServerOptions) => Promise<AgentPayHttpServer>;
  startSetupWebServer?: (
    dependencies: SetupWebDependencies,
    options?: { port?: number; hostname?: string },
  ) => Promise<{ close(): Promise<void>; url: string }>;
  install?: (options: InstallAgentPayOptions) => Promise<InstallAgentPayResult>;
}

export interface AgentPayDoctorSection {
  status: "ready" | "missing" | "invalid";
  missing: string[];
  invalid: string[];
}

export interface AgentPayDoctorReport {
  ok: boolean;
  mcp: AgentPayDoctorSection;
  setup: AgentPayDoctorSection;
  text: string;
}

export interface CreateAgentPayConfigOptions {
  accountBytecodePath?: string;
}

export function parseCliArgs(args: string[]): AgentPayCliCommand {
  const [command = "help", ...rest] = args;

  if (command === "mcp") {
    assertNoArguments(command, rest);
    return { command: "mcp" };
  }

  if (command === "serve-http") {
    assertKnownOptions(rest, ["--host", "--port"], []);
    return {
      command: "serve-http",
      hostname: readOption(rest, "--host") ?? "0.0.0.0",
      port: parsePort(readOption(rest, "--port") ?? "3001"),
    };
  }

  if (command === "doctor") {
    assertNoArguments(command, rest);
    return { command: "doctor" };
  }

  if (command === "setup-web") {
    assertNoArguments(command, rest);
    return { command: "setup-web" };
  }

  if (command === "install") {
    assertKnownOptions(rest, ["--runtime", "--mcp-url", "--output-dir"], ["--force", "--self-hosted"]);
    const runtime = readOption(rest, "--runtime");
    const mcpUrl = readOption(rest, "--mcp-url") ?? DEFAULT_HOSTED_MCP_URL;
    assertSafeMcpUrl(mcpUrl);
    return {
      command: "install",
      runtime: runtime ? parseRuntime(runtime) : undefined,
      outputDir: expandHome(readOption(rest, "--output-dir") ?? DEFAULT_INSTALL_DIR),
      force: rest.includes("--force"),
      selfHosted: rest.includes("--self-hosted"),
      mcpUrl,
    };
  }

  if (command === "help" || command === "--help" || command === "-h") {
    assertNoArguments(command, rest);
    return { command: "help" };
  }

  throw new Error(`Unknown AgentPay command: ${command}`);
}

export async function runAgentPayCli(
  args: string[],
  dependencies: RunAgentPayCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((message: string) => console.log(message));
  const stderr = dependencies.stderr ?? ((message: string) => console.error(message));

  try {
    const command = parseCliArgs(args);

    if (command.command === "help") {
      stdout(createHelpText());
      return 0;
    }

    if (command.command === "mcp") {
      const env = await loadAgentPayConfigEnv(dependencies.env ?? process.env);
      await (dependencies.startMcpServer ?? startAgentPayMcpServer)({ env });
      return 0;
    }

    if (command.command === "serve-http") {
      const env = await loadAgentPayConfigEnv(dependencies.env ?? process.env);
      const server = await (dependencies.startHttpServer ?? startAgentPayHttpServer)({
        env,
        hostname: command.hostname,
        port: command.port,
      });
      const surface = env.AGENTPAY_HTTP_MODE === "consumer" ? "consumer" : "public";
      stdout(`AgentPay ${surface} MCP listening at ${server.mcpUrl}`);
      stdout(`AgentPay health check at ${server.healthUrl}`);
      stdout(`AgentPay readiness check at ${server.readinessUrl}`);
      return 0;
    }

    if (command.command === "doctor") {
      const report = await runAgentPayDoctor(dependencies.env ?? process.env);
      stdout(report.text);
      return report.ok ? 0 : 1;
    }

    if (command.command === "setup-web") {
      const env = await loadAgentPayConfigEnv(dependencies.env ?? process.env);
      const config = parseSetupWebEnv(env);
      const server = await (dependencies.startSetupWebServer ?? startSetupWebServer)(
        createSetupWebDependencies(config),
        {
          port: config.setupWebPort ?? 3000,
        },
      );
      stdout(`AgentPay setup web listening at ${server.url}`);
      return 0;
    }

    const runtime = command.runtime ?? detectAgentPayRuntime(process.cwd());
    if (!runtime) {
      throw new Error(
        "AgentPay could not detect an agent runtime. Re-run with --runtime <codex|claude|cursor|generic|hermes>.",
      );
    }
    const installCommand: InstallAgentPayOptions = {
      ...command,
      runtime,
    };
    const result = await (dependencies.install ?? installAgentPay)(installCommand);
    stdout(`AgentPay installed for ${result.runtime} at ${result.outputDir}`);
    stdout(`Wrote ${result.writtenFiles.length} files.`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : "AgentPay CLI failed.");
    return 1;
  }
}

export async function installAgentPay(options: InstallAgentPayOptions): Promise<InstallAgentPayResult> {
  const packageRoot = options.packageRoot ?? findPackageRoot();
  const cliRoot = resolveCliPackageRoot(packageRoot);
  const skillRoot = options.skillRoot ?? resolveAgentPaySkillRoot(packageRoot);
  const runtimeDir = join(options.outputDir, "runtimes", options.runtime);
  const skillDir = join(options.outputDir, "skills", AGENTPAY_SKILL_NAME);
  const templateDir = join(cliRoot, "templates", options.runtime);
  const templateFiles = getRuntimeTemplateFiles(options.runtime);
  const bytecodePath = join(options.outputDir, "AgentPayAccount.bin");
  const configPath = join(options.outputDir, "config.json");
  const selfHosted = Boolean(options.selfHosted);
  const selfHostedConfig = selfHosted
    ? await createInstallConfigContents(configPath, bytecodePath, Boolean(options.force))
    : undefined;
  const mcpConfig = createAgentPayMcpConfig({
    selfHosted,
    mcpUrl: options.mcpUrl ?? DEFAULT_HOSTED_MCP_URL,
    configPath,
  });
  const serverConfig = (mcpConfig.mcpServers as Record<string, Record<string, unknown>>)[
    AGENTPAY_MCP_SERVER_NAME
  ];
  if (!serverConfig) throw new Error("AgentPay MCP configuration could not be generated.");
  const nativeConfigUpdate =
    options.installNativeRuntimeConfig === false
      ? undefined
      : await prepareNativeRuntimeConfigUpdate(options, serverConfig);
  const nativeSkillDir =
    options.runtime === "codex" && options.installNativeRuntimeConfig !== false
      ? join(options.agentSkillsRoot ?? join(homedir(), ".agents", "skills"), AGENTPAY_SKILL_NAME)
      : undefined;
  const filesToWrite = [
    ...(selfHosted
      ? [
          {
            from: undefined,
            to: configPath,
            contents: selfHostedConfig,
            mode: 0o600,
          },
          {
            from: join(cliRoot, "assets", "AgentPayAccount.bin"),
            to: bytecodePath,
            contents: undefined,
            mode: undefined,
          },
        ]
      : []),
    {
      from: join(skillRoot, "SKILL.md"),
      to: join(skillDir, "SKILL.md"),
      contents: undefined,
      mode: undefined,
    },
    {
      from: join(skillRoot, "agents", "openai.yaml"),
      to: join(skillDir, "agents", "openai.yaml"),
      contents: undefined,
      mode: undefined,
    },
    ...(nativeSkillDir
      ? [
          {
            from: join(skillRoot, "SKILL.md"),
            to: join(nativeSkillDir, "SKILL.md"),
            contents: undefined,
            mode: undefined,
          },
          {
            from: join(skillRoot, "agents", "openai.yaml"),
            to: join(nativeSkillDir, "agents", "openai.yaml"),
            contents: undefined,
            mode: undefined,
          },
        ]
      : []),
    ...templateFiles.map((fileName) => ({
      from: isMcpConfigTemplateFile(fileName) ? undefined : join(templateDir, fileName),
      to: join(runtimeDir, fileName),
      contents: isMcpConfigTemplateFile(fileName)
        ? `${JSON.stringify(mcpConfig, null, 2)}\n`
        : undefined,
      mode: undefined,
    })),
  ];

  await Promise.all(filesToWrite.map((file) => assertWritable(file.to, Boolean(options.force))));
  await mkdir(runtimeDir, { recursive: true });

  const writtenFiles = await Promise.all(
    filesToWrite.map(async (file) => {
      await mkdir(dirname(file.to), { recursive: true });

      if (file.contents !== undefined) {
        await writeFile(file.to, file.contents, { encoding: "utf8", ...(file.mode ? { mode: file.mode } : {}) });
        if (file.mode) {
          await chmod(file.to, file.mode);
        }
      } else if (file.from) {
        await copyFile(file.from, file.to);
      }

      return file.to;
    }),
  );

  if (nativeConfigUpdate) {
    await mkdir(dirname(nativeConfigUpdate.path), { recursive: true });
    await writeFile(nativeConfigUpdate.path, nativeConfigUpdate.contents, "utf8");
    writtenFiles.push(nativeConfigUpdate.path);
  }

  return {
    outputDir: options.outputDir,
    runtime: options.runtime,
    writtenFiles,
  };
}

export function createAgentPayConfig(options: CreateAgentPayConfigOptions = {}): Record<string, string> {
  return {
    ...Object.fromEntries([...requiredConfigKeys, ...optionalConfigKeys].map((key) => [key, ""])),
    AGENTPAY_ACCOUNT_BYTECODE_PATH: options.accountBytecodePath ?? "",
  };
}

async function createInstallConfigContents(
  configPath: string,
  accountBytecodePath: string,
  force: boolean,
): Promise<string> {
  const defaults = createAgentPayConfig({ accountBytecodePath });
  if (!force) {
    return `${JSON.stringify(defaults, null, 2)}\n`;
  }

  const existing = await readJsonObjectIfPresent(configPath);
  return `${JSON.stringify({ ...defaults, ...existing }, null, 2)}\n`;
}

async function readJsonObjectIfPresent(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path} must contain a JSON object.`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === "ENOENT") return {};
    throw error;
  }
}

export async function loadAgentPayConfigEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  const configPath = env.AGENTPAY_CONFIG ? expandHome(env.AGENTPAY_CONFIG) : undefined;

  if (!configPath) {
    return { ...env };
  }

  const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const configEnv = Object.fromEntries(
    Object.entries(rawConfig)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value as string]),
  );

  return {
    ...configEnv,
    ...env,
  };
}

export async function runAgentPayDoctor(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<AgentPayDoctorReport> {
  const merged = await loadAgentPayConfigEnv(env);
  const normalized = normalizeEnv(merged);
  const mcp = validateMcpConfig(normalized);
  const setup = await validateSetupConfig(normalized);
  const ok = mcp.status === "ready" && setup.status === "ready";

  return {
    ok,
    mcp,
    setup,
    text: [
      "AgentPay doctor",
      formatDoctorSection("MCP runtime", mcp),
      formatDoctorSection("Setup web", setup),
      ok ? "Ready: MCP and setup web configuration are complete." : "Not ready: fill the missing or invalid config names above.",
    ].join("\n"),
  };
}

function parseRuntime(value: string): AgentPayRuntimeName {
  if (runtimeNames.includes(value as AgentPayRuntimeName)) {
    return value as AgentPayRuntimeName;
  }

  throw new Error(`Unsupported AgentPay runtime: ${value}`);
}

function parsePort(value: string): number {
  if (!isPort(value)) {
    throw new Error(`Unsupported AgentPay HTTP port: ${value}`);
  }

  return Number(value);
}

function validateMcpConfig(env: Record<string, string | undefined>): AgentPayDoctorSection {
  const missing = requiredConfigKeys.filter((name) => !env[name]);
  const invalid = [
    env.SUPABASE_URL && !isHttpUrl(env.SUPABASE_URL) ? "SUPABASE_URL" : undefined,
    env.CELO_RPC_URL && !isHttpUrl(env.CELO_RPC_URL) ? "CELO_RPC_URL" : undefined,
    env.CELO_MAINNET_RPC_URL && !isHttpUrl(env.CELO_MAINNET_RPC_URL)
      ? "CELO_MAINNET_RPC_URL"
      : undefined,
    env.CELO_SEPOLIA_RPC_URL && !isHttpUrl(env.CELO_SEPOLIA_RPC_URL)
      ? "CELO_SEPOLIA_RPC_URL"
      : undefined,
    env.EXECUTOR_PRIVATE_KEY && !privateKeyPattern.test(env.EXECUTOR_PRIVATE_KEY)
      ? "EXECUTOR_PRIVATE_KEY"
      : undefined,
    env.LIFI_BASE_URL && !isHttpUrl(env.LIFI_BASE_URL) ? "LIFI_BASE_URL" : undefined,
    env.X402_BAZAAR_FACILITATOR_URL && !isHttpUrl(env.X402_BAZAAR_FACILITATOR_URL)
      ? "X402_BAZAAR_FACILITATOR_URL"
      : undefined,
    env.SETUP_WEB_URL && !isSecureReviewUrl(env.SETUP_WEB_URL) ? "SETUP_WEB_URL" : undefined,
    env.AGENTPAY_REVIEW_TOKEN_SECRET && env.AGENTPAY_REVIEW_TOKEN_SECRET.length < 32
      ? "AGENTPAY_REVIEW_TOKEN_SECRET"
      : undefined,
  ].filter((name): name is string => Boolean(name));

  return createDoctorSection(missing, invalid);
}

async function validateSetupConfig(env: Record<string, string | undefined>): Promise<AgentPayDoctorSection> {
  const hasInlineBytecode = Boolean(env.AGENTPAY_ACCOUNT_BYTECODE);
  const hasBytecodePath = Boolean(env.AGENTPAY_ACCOUNT_BYTECODE_PATH);
  const missing = [
    ...setupRequiredConfigKeys.filter((name) => !env[name]),
    !hasInlineBytecode && !hasBytecodePath ? "AGENTPAY_ACCOUNT_BYTECODE" : undefined,
  ].filter((name): name is string => Boolean(name));
  const invalid = [
    env.SUPABASE_URL && !isHttpUrl(env.SUPABASE_URL) ? "SUPABASE_URL" : undefined,
    env.CELO_RPC_URL && !isHttpUrl(env.CELO_RPC_URL) ? "CELO_RPC_URL" : undefined,
    env.CELO_MAINNET_RPC_URL && !isHttpUrl(env.CELO_MAINNET_RPC_URL)
      ? "CELO_MAINNET_RPC_URL"
      : undefined,
    env.CELO_SEPOLIA_RPC_URL && !isHttpUrl(env.CELO_SEPOLIA_RPC_URL)
      ? "CELO_SEPOLIA_RPC_URL"
      : undefined,
    env.SETUP_DEPLOYER_PRIVATE_KEY && !privateKeyPattern.test(env.SETUP_DEPLOYER_PRIVATE_KEY)
      ? "SETUP_DEPLOYER_PRIVATE_KEY"
      : undefined,
    env.AGENTPAY_ACCOUNT_BYTECODE && !hexDataPattern.test(env.AGENTPAY_ACCOUNT_BYTECODE)
      ? "AGENTPAY_ACCOUNT_BYTECODE"
      : undefined,
    env.AGENTPAY_ACCOUNT_VERSION && env.AGENTPAY_ACCOUNT_VERSION !== "v2"
      ? "AGENTPAY_ACCOUNT_VERSION"
      : undefined,
    env.AGENTPAY_ACCOUNT_BYTECODE_HASH && !bytes32Pattern.test(env.AGENTPAY_ACCOUNT_BYTECODE_HASH)
      ? "AGENTPAY_ACCOUNT_BYTECODE_HASH"
      : undefined,
    env.AGENTPAY_REVIEW_TOKEN_SECRET && env.AGENTPAY_REVIEW_TOKEN_SECRET.length < 32
      ? "AGENTPAY_REVIEW_TOKEN_SECRET"
      : undefined,
    env.AGENTPAY_ENVIRONMENT === "production" ? "production setup deployment surface" : undefined,
    env.AGENTPAY_HOME_CHAIN_ID === "42220" ? "mainnet setup deployment surface" : undefined,
    env.AGENTPAY_ACCOUNT_BYTECODE_PATH && !(await canReadFile(env.AGENTPAY_ACCOUNT_BYTECODE_PATH))
      ? "AGENTPAY_ACCOUNT_BYTECODE_PATH"
      : undefined,
    parseAddressList(env.AGENTPAY_INITIAL_ROUTE_TARGETS).some((target) => !addressPattern.test(target))
      ? "AGENTPAY_INITIAL_ROUTE_TARGETS"
      : undefined,
    env.AGENTPAY_HOME_CHAIN_ID && !isSetupHomeChainId(env.AGENTPAY_HOME_CHAIN_ID)
      ? "AGENTPAY_HOME_CHAIN_ID"
      : undefined,
    env.AGENTPAY_ACCOUNT_ADDRESS && !addressPattern.test(env.AGENTPAY_ACCOUNT_ADDRESS)
      ? "AGENTPAY_ACCOUNT_ADDRESS"
      : undefined,
    ...validateStableTokenOverrideAddresses(env),
    env.SETUP_WEB_PORT && !isPort(env.SETUP_WEB_PORT) ? "SETUP_WEB_PORT" : undefined,
  ].filter((name): name is string => Boolean(name));

  return createDoctorSection(missing, invalid);
}

function createDoctorSection(missing: string[], invalid: string[]): AgentPayDoctorSection {
  return {
    status: missing.length > 0 ? "missing" : invalid.length > 0 ? "invalid" : "ready",
    missing,
    invalid,
  };
}

function formatDoctorSection(label: string, section: AgentPayDoctorSection): string {
  if (section.status === "ready") {
    return `${label}: ready`;
  }

  const parts = [
    section.missing.length > 0 ? `missing ${section.missing.join(", ")}` : undefined,
    section.invalid.length > 0 ? `invalid ${section.invalid.join(", ")}` : undefined,
  ].filter(Boolean);

  return `${label}: ${parts.join("; ")}`;
}

function normalizeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value?.trim() === "" ? undefined : value?.trim()]),
  );
}

function parseAddressList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
}

async function canReadFile(path: string): Promise<boolean> {
  try {
    await access(expandHome(path), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSecureReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") {
      return true;
    }
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isPort(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535;
}

function isSetupHomeChainId(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && [42220, 11142220].includes(parsed);
}

function validateStableTokenOverrideAddresses(env: Record<string, string | undefined>): string[] {
  return [
    "AGENTPAY_CELO_USDC_ADDRESS",
    "AGENTPAY_CELO_USDT_ADDRESS",
    "AGENTPAY_CELO_USDM_ADDRESS",
    "AGENTPAY_CELO_SEPOLIA_USDC_ADDRESS",
    "AGENTPAY_CELO_SEPOLIA_USDT_ADDRESS",
    "AGENTPAY_CELO_SEPOLIA_USDM_ADDRESS",
  ].filter((name) => env[name] && !addressPattern.test(env[name]));
}

function readOption(args: string[], optionName: string): string | undefined {
  const separateIndexes = args
    .map((arg, index) => (arg === optionName ? index : -1))
    .filter((index) => index >= 0);
  const inlineOptions = args.filter((arg) => arg.startsWith(`${optionName}=`));

  if (separateIndexes.length + inlineOptions.length > 1) {
    throw new Error(`${optionName} may be provided only once.`);
  }

  if (separateIndexes.length === 1) {
    const value = args[separateIndexes[0] + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${optionName} requires a value.`);
    }
    return value;
  }

  if (inlineOptions.length === 1) {
    const value = inlineOptions[0].slice(optionName.length + 1);
    if (!value) throw new Error(`${optionName} requires a value.`);
    return value;
  }

  return undefined;
}

function assertNoArguments(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(`${command} does not accept arguments.`);
  }
}

function assertKnownOptions(args: string[], valueOptions: string[], booleanOptions: string[]): void {
  const booleanCounts = new Map<string, number>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valueOptions.some((option) => argument.startsWith(`${option}=`))) {
      continue;
    }
    if (valueOptions.includes(argument)) {
      index += 1;
      continue;
    }
    if (booleanOptions.includes(argument)) {
      const count = (booleanCounts.get(argument) ?? 0) + 1;
      booleanCounts.set(argument, count);
      if (count > 1) {
        throw new Error(`${argument} may be provided only once.`);
      }
      continue;
    }
    throw new Error(`Unknown option or argument: ${argument}`);
  }
}

function assertSafeMcpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AgentPay MCP URL must be a valid HTTPS or loopback HTTP URL.");
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if ((!secure && !loopback) || url.username || url.password) {
    throw new Error("AgentPay MCP URL must use HTTPS or loopback HTTP and must not contain credentials.");
  }
}

function detectAgentPayRuntime(projectDir: string): AgentPayRuntimeName | undefined {
  const markers: Array<{ runtime: AgentPayRuntimeName; paths: string[] }> = [
    { runtime: "codex", paths: [".codex"] },
    { runtime: "cursor", paths: [".cursor"] },
    { runtime: "claude", paths: [".claude", "CLAUDE.md"] },
    { runtime: "hermes", paths: [".hermes"] },
  ];

  const detected = markers
    .filter((marker) => marker.paths.some((path) => existsSync(join(projectDir, path))))
    .map((marker) => marker.runtime);

  return detected.length === 1 ? detected[0] : undefined;
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function createHelpText(): string {
  return [
    "AgentPay",
    "",
    "Commands:",
    "  agentpay-celo install [--runtime <codex|claude|cursor|generic|hermes>] [--output-dir ~/.agentpay-celo] [--force]",
    "  agentpay-celo install --self-hosted [--runtime <codex|claude|cursor|generic|hermes>] [--output-dir ~/.agentpay-celo] [--force]",
    "  agentpay-celo doctor",
    "  agentpay-celo setup-web",
    "  agentpay-celo mcp",
    "  agentpay-celo serve-http [--host 0.0.0.0] [--port 3001]",
  ].join("\n");
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void runAgentPayCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

function isMainModule(moduleUrl: string, entrypoint: string | undefined): boolean {
  return entrypoint !== undefined && fileURLToPath(moduleUrl) === resolve(entrypoint);
}
