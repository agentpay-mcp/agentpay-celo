import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type PaymentOption,
  type ProcessSettleResultResponse,
} from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { MAINNET_CAIP2, MAINNET_USDC_ADDRESS } from "../runtime/production-readiness.ts";

const enabledValues = new Set(["1", "true", "yes", "on"]);
const disabledValues = new Set(["0", "false", "no", "off"]);
const DEFAULT_A2MCP_PAYMENT_NETWORK = MAINNET_CAIP2 satisfies Network;
const DEFAULT_A2MCP_PAYMENT_TIMEOUT_SECONDS = 300;
const DEFAULT_A2MCP_PAYMENT_ASSET_DECIMALS = 6;
const CELO_SEPOLIA_CAIP2 = "eip155:11142220" satisfies Network;
const CELO_SEPOLIA_USDC_ADDRESS = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";
const CELO_FACILITATOR_URLS: Readonly<Record<string, string>> = {
  [MAINNET_CAIP2]: "https://api.x402.celo.org",
  [CELO_SEPOLIA_CAIP2]: "https://api.x402.sepolia.celo.org",
};
const CELO_USDC_BY_NETWORK: Readonly<Record<string, string>> = {
  [MAINNET_CAIP2]: MAINNET_USDC_ADDRESS,
  [CELO_SEPOLIA_CAIP2]: CELO_SEPOLIA_USDC_ADDRESS,
};
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const caip2EvmNetworkPattern = /^eip155:\d+$/;

export interface AgentPayMcpPaymentProcessor {
  expectedPaymentRequirements: ExpectedX402PaymentRequirements;
  processHTTPRequest(context: HTTPRequestContext): Promise<
    | { type: "no-payment-required" }
    | {
        type: "payment-verified";
        paymentPayload: PaymentPayload;
        paymentRequirements: PaymentRequirements;
        declaredExtensions?: Record<string, unknown>;
      }
    | { type: "payment-error"; response: HTTPResponseInstructions }
  >;
  processSettlement(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements,
    declaredExtensions?: Record<string, unknown>,
    transportContext?: Parameters<x402HTTPResourceServer["processSettlement"]>[3],
  ): Promise<ProcessSettleResultResponse>;
}

export interface ExpectedX402PaymentRequirements {
  scheme: string;
  network: Network;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  assetTransferMethod: string;
}

export interface AgentPayMcpPaymentConfig {
  enabled: boolean;
  payTo: string;
  price: string;
  network: Network;
  asset?: string;
  maxTimeoutSeconds: number;
  facilitatorUrl?: string;
  facilitatorApiKey?: string;
  syncSettle?: boolean;
  assetTransferMethod: "eip3009";
  assetDecimals: number;
}

export interface CreateCeloAgentPaymentProcessorOptions {
  mcpPath: string;
}

export function parseAgentPayMcpPaymentEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AgentPayMcpPaymentConfig | undefined {
  const normalized = normalizeEnv(env);
  const enabledValue = normalized.AGENTPAY_A2MCP_PAYMENT_ENABLED?.toLowerCase();

  if (enabledValue && !enabledValues.has(enabledValue) && !disabledValues.has(enabledValue)) {
    throw new Error("Invalid AgentPay A2MCP payment environment (invalid: AGENTPAY_A2MCP_PAYMENT_ENABLED).");
  }
  if (!enabledValue || disabledValues.has(enabledValue)) {
    return undefined;
  }

  const maxTimeoutSeconds = parseOptionalPositiveInteger(
    normalized.AGENTPAY_A2MCP_PAYMENT_MAX_TIMEOUT_SECONDS,
    DEFAULT_A2MCP_PAYMENT_TIMEOUT_SECONDS,
  );
  const assetDecimals = parseOptionalPositiveInteger(
    normalized.AGENTPAY_A2MCP_PAYMENT_ASSET_DECIMALS,
    DEFAULT_A2MCP_PAYMENT_ASSET_DECIMALS,
  );
  const network = normalized.AGENTPAY_A2MCP_PAYMENT_NETWORK ?? DEFAULT_A2MCP_PAYMENT_NETWORK;
  const asset = normalized.AGENTPAY_A2MCP_PAYMENT_ASSET ?? CELO_USDC_BY_NETWORK[network];
  const facilitatorUrl = normalized.AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL ?? CELO_FACILITATOR_URLS[network];
  const missing = [
    normalized.AGENTPAY_A2MCP_PAYMENT_PAY_TO ? undefined : "AGENTPAY_A2MCP_PAYMENT_PAY_TO",
    normalized.AGENTPAY_A2MCP_PAYMENT_PRICE ? undefined : "AGENTPAY_A2MCP_PAYMENT_PRICE",
  ].filter((name): name is string => Boolean(name));
  if (!facilitatorUrl) missing.push("AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL");
  if (!normalized.AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL && !normalized.AGENTPAY_CELO_X402_API_KEY) {
    missing.push("AGENTPAY_CELO_X402_API_KEY");
  }

  const invalid = [
    normalized.AGENTPAY_A2MCP_PAYMENT_PAY_TO && !addressPattern.test(normalized.AGENTPAY_A2MCP_PAYMENT_PAY_TO)
      ? "AGENTPAY_A2MCP_PAYMENT_PAY_TO"
      : undefined,
    asset && !addressPattern.test(asset) ? "AGENTPAY_A2MCP_PAYMENT_ASSET" : undefined,
    CELO_USDC_BY_NETWORK[network] && asset?.toLowerCase() !== CELO_USDC_BY_NETWORK[network].toLowerCase()
      ? "AGENTPAY_A2MCP_PAYMENT_ASSET"
      : undefined,
    !caip2EvmNetworkPattern.test(network) || !CELO_USDC_BY_NETWORK[network]
      ? "AGENTPAY_A2MCP_PAYMENT_NETWORK"
      : undefined,
    normalized.AGENTPAY_A2MCP_PAYMENT_MAX_TIMEOUT_SECONDS && !maxTimeoutSeconds
      ? "AGENTPAY_A2MCP_PAYMENT_MAX_TIMEOUT_SECONDS"
      : undefined,
    normalized.AGENTPAY_A2MCP_PAYMENT_ASSET_DECIMALS && !assetDecimals
      ? "AGENTPAY_A2MCP_PAYMENT_ASSET_DECIMALS"
      : undefined,
    assetDecimals && assetDecimals !== DEFAULT_A2MCP_PAYMENT_ASSET_DECIMALS
      ? "AGENTPAY_A2MCP_PAYMENT_ASSET_DECIMALS"
      : undefined,
    normalized.AGENTPAY_A2MCP_PAYMENT_PRICE
      && assetDecimals
      && !isValidAssetPrice(normalized.AGENTPAY_A2MCP_PAYMENT_PRICE, assetDecimals)
      ? "AGENTPAY_A2MCP_PAYMENT_PRICE"
      : undefined,
    facilitatorUrl && !isHttpUrl(facilitatorUrl)
      ? "AGENTPAY_A2MCP_PAYMENT_FACILITATOR_URL"
      : undefined,
    normalized.AGENTPAY_A2MCP_PAYMENT_ASSET_TRANSFER_METHOD &&
    normalized.AGENTPAY_A2MCP_PAYMENT_ASSET_TRANSFER_METHOD !== "eip3009"
      ? "AGENTPAY_A2MCP_PAYMENT_ASSET_TRANSFER_METHOD"
      : undefined,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0 || invalid.length > 0) {
    throw new Error(createPaymentConfigErrorMessage(missing, invalid));
  }

  return omitUndefined({
    enabled: true,
    payTo: normalized.AGENTPAY_A2MCP_PAYMENT_PAY_TO,
    price: normalized.AGENTPAY_A2MCP_PAYMENT_PRICE,
    network: network as Network,
    asset,
    maxTimeoutSeconds,
    assetDecimals,
    facilitatorUrl,
    facilitatorApiKey: normalized.AGENTPAY_CELO_X402_API_KEY,
    syncSettle: parseOptionalBoolean(normalized.AGENTPAY_A2MCP_PAYMENT_SYNC_SETTLE, "AGENTPAY_A2MCP_PAYMENT_SYNC_SETTLE"),
    assetTransferMethod: "eip3009" as const,
  }) as AgentPayMcpPaymentConfig;
}

export async function createCeloAgentPaymentProcessorFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: CreateCeloAgentPaymentProcessorOptions,
): Promise<AgentPayMcpPaymentProcessor | undefined> {
  const config = parseAgentPayMcpPaymentEnv(env);

  return config ? createCeloAgentPaymentProcessor(config, options) : undefined;
}

export async function createCeloAgentPaymentProcessor(
  config: AgentPayMcpPaymentConfig,
  options: CreateCeloAgentPaymentProcessorOptions,
): Promise<AgentPayMcpPaymentProcessor> {
  const resourceServer = new x402ResourceServer(createFacilitatorClient(config));
  resourceServer.register(config.network, new ExactEvmScheme());

  const resourceConfig = {
    accepts: createCeloPaymentOption(config),
    description: "AgentPay public MCP endpoint",
    mimeType: "application/json",
    unpaidResponseBody() {
      return {
        contentType: "application/json",
        body: {
          error: "Payment required.",
          protocol: "x402 on Celo",
        },
      };
    },
    settlementFailedResponseBody() {
      return {
        contentType: "application/json",
        body: {
          error: "Payment settlement failed.",
          protocol: "x402 on Celo",
        },
      };
    },
  };
  const paymentServer = new x402HTTPResourceServer(resourceServer, {
    [`GET ${options.mcpPath}`]: resourceConfig,
    [`POST ${options.mcpPath}`]: resourceConfig,
  });

  await paymentServer.initialize();

  return {
    expectedPaymentRequirements: createCeloExpectedPaymentTerms(config),
    processHTTPRequest: (context) => paymentServer.processHTTPRequest(context),
    processSettlement: (paymentPayload, requirements, declaredExtensions, transportContext) =>
      paymentServer.processSettlement(paymentPayload, requirements, declaredExtensions, transportContext),
  };
}

function createFacilitatorClient(config: AgentPayMcpPaymentConfig) {
  const apiKey = config.facilitatorApiKey;
  return new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    ...(apiKey
      ? {
          createAuthHeaders: async () => ({
            verify: { "X-API-Key": apiKey },
            settle: { "X-API-Key": apiKey },
            supported: { "X-API-Key": apiKey },
          }),
        }
      : {}),
  });
}

export function createCeloPaymentOption(config: AgentPayMcpPaymentConfig): PaymentOption {
  const price = config.asset
    ? {
        amount: assetPriceToAtomic(config.price, config.assetDecimals),
        asset: config.asset,
        extra: {
          name: "USDC",
          version: "2",
        },
      }
    : config.price;

  return {
    scheme: "exact",
    network: config.network,
    payTo: config.payTo,
    price,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: omitUndefined({
      assetTransferMethod: config.assetTransferMethod,
      decimals: config.assetDecimals,
    }),
  };
}

export function createCeloExpectedPaymentTerms(
  config: AgentPayMcpPaymentConfig,
): ExpectedX402PaymentRequirements {
  if (!config.asset) {
    throw new Error("Celo x402 seller configuration requires an ERC-20 asset.");
  }

  return {
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    amount: assetPriceToAtomic(config.price, config.assetDecimals),
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    assetTransferMethod: config.assetTransferMethod,
  };
}

function isValidAssetPrice(price: string, decimals: number): boolean {
  try {
    assetPriceToAtomic(price, decimals);
    return true;
  } catch {
    return false;
  }
}

function assetPriceToAtomic(price: string, decimals: number): string {
  if (/^[1-9]\d*$/.test(price)) {
    return price;
  }

  const match = /^\$(\d+)(?:\.(\d+))?$/.exec(price);

  if (!match) {
    throw new Error("Seller price must be a positive atomic integer or a dollar-denominated decimal.");
  }

  const whole = match[1] ?? "0";
  const fractional = match[2] ?? "";

  if (fractional.length > decimals) {
    throw new Error(`Seller price exceeds the configured ${decimals}-decimal asset precision.`);
  }

  const atomic = (BigInt(whole) * (10n ** BigInt(decimals)))
    + BigInt(fractional.padEnd(decimals, "0") || "0");

  if (atomic <= 0n) {
    throw new Error("Seller price must be positive.");
  }

  return atomic.toString();
}

function createPaymentConfigErrorMessage(missing: string[], invalid: string[]): string {
  const parts = [
    missing.length > 0 ? `missing: ${missing.join(", ")}` : undefined,
    invalid.length > 0 ? `invalid: ${invalid.join(", ")}` : undefined,
  ].filter(Boolean);

  return `Invalid AgentPay A2MCP payment environment (${parts.join("; ")}).`;
}

function normalizeEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value?.trim() === "" ? undefined : value?.trim()]),
  );
}

function parseOptionalPositiveInteger(value: string | undefined, fallback: number): number | undefined {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (enabledValues.has(normalized)) return true;
  if (disabledValues.has(normalized)) return false;
  throw new Error(`Invalid AgentPay A2MCP payment environment (invalid: ${name}).`);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function omitUndefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}
