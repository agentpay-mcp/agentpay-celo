import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentPayRuntimeName, InstallAgentPayOptions } from "./index.ts";

export const AGENTPAY_MCP_SERVER_NAME = "agentpay-celo";
export const AGENTPAY_SKILL_NAME = "agentpay-celo";
export const AGENTPAY_CLI_PACKAGE_SPEC = "@agentpay-ai/agentpay-celo@0.1.19";

const require = createRequire(import.meta.url);

export function getRuntimeTemplateFiles(runtime: AgentPayRuntimeName): string[] {
  if (runtime === "claude") {
    return ["CLAUDE.md", "claude_desktop_config.json"];
  }

  if (runtime === "cursor") {
    return ["mcp.json", "rules.md"];
  }

  if (runtime === "codex") {
    return ["AGENTS.md", "mcp.json"];
  }

  return ["instructions.md", "mcp.json"];
}

export function isMcpConfigTemplateFile(fileName: string): boolean {
  return fileName === "mcp.json" || fileName === "claude_desktop_config.json";
}

export function createAgentPayMcpConfig(options: {
  selfHosted: boolean;
  mcpUrl: string;
  configPath: string;
}): Record<string, unknown> {
  return {
    mcpServers: {
      [AGENTPAY_MCP_SERVER_NAME]: options.selfHosted
        ? {
            command: "npx",
            args: ["-y", AGENTPAY_CLI_PACKAGE_SPEC, "mcp"],
            env: {
              AGENTPAY_CONFIG: options.configPath,
            },
          }
        : {
            url: options.mcpUrl,
          },
    },
  };
}

export async function prepareNativeRuntimeConfigUpdate(
  options: InstallAgentPayOptions,
  serverConfig: Record<string, unknown>,
): Promise<{ path: string; contents: string } | undefined> {
  const configPath = getNativeRuntimeConfigPath(options);
  if (!configPath) return undefined;
  await assertNotSymbolicLink(configPath);

  if (options.runtime === "codex") {
    const contents = await readTextIfPresent(configPath);
    return {
      path: configPath,
      contents: upsertCodexAgentPayMcpServer(contents, serverConfig, Boolean(options.force)),
    };
  }

  if (options.runtime === "hermes") {
    const contents = await readTextIfPresent(configPath);
    return {
      path: configPath,
      contents: upsertYamlMapEntry(
        contents,
        "mcp_servers",
        AGENTPAY_MCP_SERVER_NAME,
        formatHermesAgentPayMcpServer(serverConfig),
        Boolean(options.force),
      ),
    };
  }

  return {
    path: configPath,
    contents: await createJsonAgentPayMcpConfigContents(configPath, serverConfig, Boolean(options.force)),
  };
}

export async function assertWritable(path: string, force: boolean): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`${path} is a symbolic link and will not be overwritten.`);
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return;
    throw error;
  }

  if (!force) {
    throw new Error(`${path} already exists. Re-run with --force to overwrite it.`);
  }
}

export function findPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveCliPackageRoot(packageRoot: string): string {
  if (existsSync(join(packageRoot, "assets")) && existsSync(join(packageRoot, "templates"))) {
    return packageRoot;
  }

  return packageRoot.endsWith(join("packages", "cli")) ? packageRoot : join(packageRoot, "packages", "cli");
}

export function resolveAgentPaySkillRoot(packageRoot: string): string {
  const currentPackageRoot = findPackageRoot();
  const candidates = [
    join(packageRoot, "skill"),
    join(packageRoot, "packages", "skill"),
    join(dirname(packageRoot), "skill"),
    join(dirname(currentPackageRoot), "skill"),
  ];
  const localRoot = candidates.find((candidate) => existsSync(join(candidate, "SKILL.md")));

  if (localRoot) {
    return localRoot;
  }

  try {
    return dirname(require.resolve("@agentpay-ai/skill-celo/package.json"));
  } catch {
    throw new Error("AgentPay skill package was not found.");
  }
}

function getNativeRuntimeConfigPath(options: InstallAgentPayOptions): string | undefined {
  if (options.runtime === "codex") {
    return options.codexConfigPath ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
  }

  if (options.runtime === "claude") {
    return options.claudeDesktopConfigPath ?? getClaudeDesktopConfigPath();
  }

  if (options.runtime === "cursor") {
    return options.cursorMcpConfigPath ?? join(homedir(), ".cursor", "mcp.json");
  }

  if (options.runtime === "hermes") {
    return options.hermesConfigPath ?? join(homedir(), ".hermes", "config.yaml");
  }

  return undefined;
}

function getClaudeDesktopConfigPath(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude", "claude_desktop_config.json");
}

async function createJsonAgentPayMcpConfigContents(
  configPath: string,
  serverConfig: Record<string, unknown>,
  force: boolean,
): Promise<string> {
  let config: Record<string, unknown> = {};
  try {
    const rawConfig = await readFile(configPath, "utf8");
    config = rawConfig.trim() ? (JSON.parse(rawConfig) as Record<string, unknown>) : {};
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  const existingMcpServers =
    typeof config.mcpServers === "object" && config.mcpServers !== null && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  const existingAgentPay = existingMcpServers[AGENTPAY_MCP_SERVER_NAME];
  if (existingAgentPay !== undefined && JSON.stringify(existingAgentPay) !== JSON.stringify(serverConfig) && !force) {
    throw new Error(
      `${configPath} already contains ${AGENTPAY_MCP_SERVER_NAME}. Re-run with --force to replace that entry.`,
    );
  }
  const nextConfig = {
    ...config,
    mcpServers: {
      ...existingMcpServers,
      [AGENTPAY_MCP_SERVER_NAME]: serverConfig,
    },
  };

  return `${JSON.stringify(nextConfig, null, 2)}\n`;
}

async function readTextIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return "";
    throw error;
  }
}

function upsertCodexAgentPayMcpServer(
  contents: string,
  serverConfig: Record<string, unknown>,
  force: boolean,
): string {
  const normalized = contents.trimEnd();
  const block = formatCodexAgentPayMcpServer(serverConfig);
  const lines = normalized ? normalized.split(/\r?\n/) : [];
  const tableHeader = `[mcp_servers.${AGENTPAY_MCP_SERVER_NAME}]`;
  const startIndexes = lines
    .map((line, index) => (line.trim() === tableHeader ? index : -1))
    .filter((index) => index >= 0);

  if (startIndexes.length > 1) {
    throw new Error(`Codex config contains duplicate ${tableHeader} tables.`);
  }
  if (startIndexes.length === 0) {
    return normalized ? `${normalized}\n\n${block}\n` : `${block}\n`;
  }

  const start = startIndexes[0];
  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => /^\[\[?[^\]]+\]\]?(?:\s*#.*)?$/.test(line.trim()));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  const currentBlock = lines.slice(start, end).join("\n").trim();
  if (currentBlock === block) return `${normalized}\n`;
  if (!force) {
    throw new Error(`Codex config already contains ${tableHeader}. Re-run with --force to replace that entry.`);
  }
  const next = [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)];
  return `${next.join("\n").trimEnd()}\n`;
}

function formatCodexAgentPayMcpServer(serverConfig: Record<string, unknown>): string {
  const lines = [`[mcp_servers.${AGENTPAY_MCP_SERVER_NAME}]`];
  if (typeof serverConfig.url === "string") {
    lines.push(`url = ${JSON.stringify(serverConfig.url)}`);
  }
  if (typeof serverConfig.command === "string") {
    lines.push(`command = ${JSON.stringify(serverConfig.command)}`);
  }
  const args = Array.isArray(serverConfig.args)
    ? serverConfig.args.filter((value): value is string => typeof value === "string")
    : [];
  if (args.length > 0) {
    lines.push(`args = [${args.map((value) => JSON.stringify(value)).join(", ")}]`);
  }
  const env = isStringRecord(serverConfig.env) ? serverConfig.env : undefined;
  if (env) {
    lines.push("", `[mcp_servers.${AGENTPAY_MCP_SERVER_NAME}.env]`);
    for (const [name, value] of Object.entries(env)) {
      lines.push(`${name} = ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}

function formatHermesAgentPayMcpServer(serverConfig: Record<string, unknown>): string[] {
  const lines = [`  ${AGENTPAY_MCP_SERVER_NAME}:`];

  if (typeof serverConfig.url === "string") {
    lines.push(`    url: ${quoteYamlString(serverConfig.url)}`);
  }

  if (typeof serverConfig.command === "string") {
    lines.push(`    command: ${quoteYamlString(serverConfig.command)}`);
  }

  const args = Array.isArray(serverConfig.args)
    ? serverConfig.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (args.length > 0) {
    lines.push("    args:");
    lines.push(...args.map((arg) => `      - ${quoteYamlString(arg)}`));
  }

  const env = isStringRecord(serverConfig.env) ? serverConfig.env : undefined;
  if (env) {
    lines.push("    env:");
    lines.push(...Object.entries(env).map(([key, value]) => `      ${key}: ${quoteYamlString(value)}`));
  }

  lines.push("    enabled: true");

  return lines;
}

function upsertYamlMapEntry(
  contents: string,
  mapKey: string,
  entryKey: string,
  entryLines: string[],
  force: boolean,
): string {
  const normalized = contents.trimEnd();

  if (!normalized) {
    return `${mapKey}:\n${entryLines.join("\n")}\n`;
  }

  const lines = normalized.split(/\r?\n/);
  const mapPattern = new RegExp(`^${escapeRegExp(mapKey)}:\\s*(?:\\{\\}|null)?\\s*(?:#.*)?$`);
  const mapStart = lines.findIndex((line) => mapPattern.test(line));

  if (mapStart < 0) {
    return `${normalized}\n\n${mapKey}:\n${entryLines.join("\n")}\n`;
  }

  const mapEnd = findNextTopLevelLine(lines, mapStart + 1);
  const absoluteMapEnd = mapEnd < 0 ? lines.length : mapEnd;
  const block = lines.slice(mapStart + 1, absoluteMapEnd);
  const entryPattern = new RegExp(`^  ${escapeRegExp(entryKey)}:\\s*(?:#.*)?$`);
  const entryStart = block.findIndex((line) => entryPattern.test(line));

  if (entryStart < 0) {
    const updated = [...lines.slice(0, absoluteMapEnd), ...entryLines, ...lines.slice(absoluteMapEnd)];
    return `${updated.join("\n")}\n`;
  }

  const entryEnd = findNextSecondLevelLine(block, entryStart + 1);
  const absoluteEntryStart = mapStart + 1 + entryStart;
  const absoluteEntryEnd = mapStart + 1 + (entryEnd < 0 ? block.length : entryEnd);
  const currentEntry = lines.slice(absoluteEntryStart, absoluteEntryEnd).join("\n").trimEnd();
  const nextEntry = entryLines.join("\n").trimEnd();
  if (currentEntry === nextEntry) {
    return `${normalized}\n`;
  }
  if (!force) {
    throw new Error(
      `Hermes config already contains ${entryKey}. Re-run with --force to replace that entry.`,
    );
  }
  const updated = [...lines.slice(0, absoluteEntryStart), ...entryLines, ...lines.slice(absoluteEntryEnd)];

  return `${updated.join("\n")}\n`;
}

function findNextTopLevelLine(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) {
      return index;
    }
  }

  return -1;
}

function findNextSecondLevelLine(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (/^  \S/.test(lines[index])) {
      return index;
    }
  }

  return -1;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertNotSymbolicLink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`${path} is a symbolic link and will not be overwritten.`);
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return;
    throw error;
  }
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}
