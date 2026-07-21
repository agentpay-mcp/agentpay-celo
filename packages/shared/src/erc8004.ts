import { z } from "zod";

export const CELO_MAINNET_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const CELO_MAINNET_REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
export const CELO_MAINNET_AGENT_REGISTRY = `eip155:42220:${CELO_MAINNET_IDENTITY_REGISTRY}` as const;
export const AGENTPAY_ERC8004_METADATA_URL =
  "https://wallet.agentpay.site/.well-known/agent-registration.json";

const registrationType = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;
const agentPayDescription =
  "Owner-authorized stablecoin payment agent for direct payments, invoices, remittance routes, and x402 services on Celo, with guarded contract-call preparation.";
const agentPayImage = "https://www.agentpay.site/agentpay-logo/agentpay-icon-192.png" as const;
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const walletEndpointPattern = /^eip155:42220:0x[a-fA-F0-9]{40}$/;

const strictHttpsUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    !url.hostname.endsWith(".example") &&
    !url.hostname.endsWith(".invalid");
}, "must be a public production HTTPS URL");

const webServiceSchema = z.object({
  name: z.literal("web"),
  endpoint: z.literal("https://www.agentpay.site/"),
}).strict();
const mcpServiceSchema = z.object({
  name: z.literal("MCP"),
  endpoint: z.literal("https://wallet.agentpay.site/celo/mcp"),
  version: z.literal("2025-06-18"),
}).strict();
const walletServiceSchema = z.object({
  name: z.literal("wallet"),
  endpoint: z.string().regex(walletEndpointPattern),
}).strict();

export const agentPayErc8004RegistrationSchema = z.object({
  type: z.literal(registrationType),
  name: z.literal("AgentPay"),
  description: z.literal(agentPayDescription),
  image: strictHttpsUrl.pipe(z.literal(agentPayImage)),
  services: z.tuple([webServiceSchema, mcpServiceSchema, walletServiceSchema]),
  x402Support: z.literal(true),
  active: z.literal(true),
  registrations: z.array(z.object({
    agentId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    agentRegistry: z.literal(CELO_MAINNET_AGENT_REGISTRY),
  }).strict()).max(1),
}).strict();

export type AgentPayErc8004Registration = z.infer<typeof agentPayErc8004RegistrationSchema>;

export interface CreateAgentPayErc8004RegistrationInput {
  agentWalletAddress: string;
  agentId?: number;
}

export function createAgentPayErc8004Registration(
  input: CreateAgentPayErc8004RegistrationInput,
): AgentPayErc8004Registration {
  const wallet = input.agentWalletAddress;
  if (!evmAddressPattern.test(wallet) || wallet.toLowerCase() === zeroAddress) {
    throw new Error("AgentPay ERC-8004 agent wallet must be a non-zero EVM address.");
  }
  if (
    input.agentId !== undefined &&
    (!Number.isSafeInteger(input.agentId) || input.agentId < 0)
  ) {
    throw new Error("AgentPay ERC-8004 agent id must be a non-negative safe integer.");
  }

  const metadata = agentPayErc8004RegistrationSchema.parse({
    type: registrationType,
    name: "AgentPay",
    description: agentPayDescription,
    image: agentPayImage,
    services: [
      { name: "web", endpoint: "https://www.agentpay.site/" },
      { name: "MCP", endpoint: "https://wallet.agentpay.site/celo/mcp", version: "2025-06-18" },
      { name: "wallet", endpoint: `eip155:42220:${wallet.toLowerCase()}` },
    ],
    x402Support: true,
    active: true,
    registrations: input.agentId === undefined
      ? []
      : [{ agentId: input.agentId, agentRegistry: CELO_MAINNET_AGENT_REGISTRY }],
  });

  return deepFreeze(metadata);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
