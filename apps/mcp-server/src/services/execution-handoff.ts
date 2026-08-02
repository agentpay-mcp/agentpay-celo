import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import {
  executePaymentInputSchema,
  type ExecutePaymentInput,
} from "@agentpay-ai/shared-celo";

export const EXECUTION_HANDOFF_PATH = "/internal/celo/execute-payment";
const DEFAULT_MAX_SKEW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;
const signaturePattern = /^sha256=([a-f0-9]{64})$/;

export interface ExecutionHandoffConfig {
  url: string;
  secret: string;
  maxSkewSeconds: number;
}

export interface ExecutionHandoffClient {
  execute(input: ExecutePaymentInput): Promise<unknown>;
}

export interface ExecutionHandoffServerVerificationInput {
  secret: string;
  timestamp: number;
  body: string | Uint8Array;
  signature: string;
  now?: number;
  maxSkewSeconds?: number;
}

export function parseExecutionHandoffEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ExecutionHandoffConfig | undefined {
  const url = normalizeEnvValue(env.AGENTPAY_INTERNAL_EXECUTION_URL);
  const secret = normalizeEnvValue(env.AGENTPAY_INTERNAL_EXECUTION_SECRET);
  const maxSkewValue = normalizeEnvValue(env.AGENTPAY_INTERNAL_EXECUTION_MAX_SKEW_SECONDS);

  if (!url && !secret && !maxSkewValue) return undefined;

  const missing = [
    url ? undefined : "AGENTPAY_INTERNAL_EXECUTION_URL",
    secret ? undefined : "AGENTPAY_INTERNAL_EXECUTION_SECRET",
  ].filter((name): name is string => Boolean(name));
  const maxSkewSeconds = parsePositiveInteger(maxSkewValue, DEFAULT_MAX_SKEW_SECONDS);
  const invalid = [
    url && !isSafeExecutionHandoffUrl(url) ? "AGENTPAY_INTERNAL_EXECUTION_URL" : undefined,
    secret && secret.length < MIN_SECRET_LENGTH ? "AGENTPAY_INTERNAL_EXECUTION_SECRET" : undefined,
    maxSkewValue && !maxSkewSeconds ? "AGENTPAY_INTERNAL_EXECUTION_MAX_SKEW_SECONDS" : undefined,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0 || invalid.length > 0) {
    const parts = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : undefined,
      invalid.length > 0 ? `invalid: ${invalid.join(", ")}` : undefined,
    ].filter(Boolean);
    throw new Error(`Invalid AgentPay execution handoff environment (${parts.join("; ")}).`);
  }

  return {
    url: url!,
    secret: secret!,
    maxSkewSeconds: maxSkewSeconds!,
  };
}

export function createExecutionHandoffSignature(input: {
  secret: string;
  timestamp: number;
  body: string | Uint8Array;
}): string {
  const material = `${input.timestamp}.${toBuffer(input.body).toString("utf8")}`;
  return `sha256=${createHmac("sha256", input.secret).update(material, "utf8").digest("hex")}`;
}

export function verifyExecutionHandoffSignature(input: ExecutionHandoffServerVerificationInput): boolean {
  const maxSkewSeconds = input.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  if (!Number.isInteger(input.timestamp) || maxSkewSeconds <= 0) return false;
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) return false;
  if (Math.abs(Math.floor(now / 1000) - input.timestamp) > maxSkewSeconds) return false;

  const expected = createExecutionHandoffSignature(input);
  const actualMatch = signaturePattern.exec(input.signature);
  if (!actualMatch) return false;
  const expectedBytes = Buffer.from(expected.slice("sha256=".length), "hex");
  const actualBytes = Buffer.from(actualMatch[1], "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function createExecutionHandoffClient(
  config: ExecutionHandoffConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => Date.now(),
  createId: () => string = randomUUID,
): ExecutionHandoffClient {
  return {
    async execute(input: ExecutePaymentInput): Promise<unknown> {
      const parsedInput = executePaymentInputSchema.parse(input);
      if (!parsedInput.signature) {
        throw new Error("Owner EIP-712 payment authorization is required for execution handoff.");
      }
      const id = createId();
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "execute_payment",
          arguments: {
            paymentIntentId: parsedInput.paymentIntentId,
            signature: parsedInput.signature,
          },
        },
      });
      const timestamp = Math.floor(now() / 1000);
      const response = await fetchImpl(config.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-agentpay-handoff-timestamp": String(timestamp),
          "x-agentpay-handoff-signature": createExecutionHandoffSignature({
            secret: config.secret,
            timestamp,
            body,
          }),
        },
        body,
      });
      const responseText = await response.text();
      const parsedResponse = parseJsonResponse(responseText);
      if (!response.ok) {
        const error = isRecord(parsedResponse?.error) ? parsedResponse.error : undefined;
        const code = typeof error?.code === "string" ? ` [${error.code}]` : "";
        const message = typeof error?.message === "string"
          ? error.message
          : typeof parsedResponse?.error === "string"
            ? parsedResponse.error
            : `Execution handoff failed with HTTP ${response.status}.`;
        throw new Error(`${message}${code}`);
      }
      if (!isRecord(parsedResponse) || !Object.prototype.hasOwnProperty.call(parsedResponse, "result")) {
        throw new Error("Execution handoff returned an invalid MCP response.");
      }
      return parsedResponse.result;
    },
  };
}

function parseJsonResponse(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number | undefined {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 900 ? parsed : undefined;
}

function isSafeExecutionHandoffUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      (isIP(hostname) === 4 && hostname === "127.0.0.1") ||
      (isIP(hostname) === 6 && hostname === "::1");
    return (url.protocol === "https:" || (url.protocol === "http:" && isLoopback)) &&
      url.username === "" && url.password === "" && url.hash === "" &&
      url.search === "" && url.pathname === EXECUTION_HANDOFF_PATH;
  } catch {
    return false;
  }
}

function toBuffer(value: string | Uint8Array): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
