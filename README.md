# AgentPay

AgentPay is a plugin-first, MCP-first payment runtime for owner-authorized stablecoin payments on Celo. An AI agent can prepare the transaction, but the smart-account owner must sign the exact EIP-712 authorization before the executor can submit it.

The Celo hackathon scope includes:

- send payments in USDC, USDT, or USDm;
- parse and pay invoices;
- discover and purchase x402 services;
- prepare batch payout workflows;
- quote remittance and swap-and-pay routes;
- make agent-to-agent payments with the same owner approval and audit trail.

The submission name and product brand are both **AgentPay**. The main website remains [agentpay.site](https://agentpay.site); the Celo implementation lives in this standalone repository and does not modify the existing X Layer deployment.

## Quick Start

Install AgentPay in a project:

```bash
npx @agentpay-ai/agentpay-celo install
```

The installer detects the target runtime and connects normal chat usage to the authenticated consumer MCP endpoint at `https://wallet.agentpay.site/celo/mcp`. The separate paid public execution endpoint is `https://mcp.agentpay.site/celo/mcp` and is used only after Review & Sign. Normal users do not need Supabase, RPC, executor, deployer, or bytecode config. Return to the agent chat and ask:

```text
Create an AgentPay wallet for me on Celo Sepolia.
```

For an operator-managed deployment, use:

```bash
npx @agentpay-ai/agentpay-celo install --self-hosted
```

Self-hosting generates local config and the pinned AgentPay smart-account bytecode.

## Chat Flow

AgentPay payment and balance tools support Celo mainnet or testnet (Celo Sepolia) through `network: "mainnet" | "testnet"`, and users can switch networks per request. Self-service chat wallet creation is currently available on Celo Sepolia. Mainnet uses an operator-managed account activation path guarded by the production readiness manifest and USDC-only canary. If the network is ambiguous, the agent asks before reading wallet state or preparing a payment.

The normal self-service Celo Sepolia wallet flow is:

1. The agent calls `prepare_wallet_creation` and gives the owner the Review & Sign URL.
2. The owner signs the setup message with a Celo-compatible wallet.
3. The agent calls `check_wallet_creation` and reports the AgentPay smart account address.
4. The owner funds the account with supported Celo USDC, USDT, or USDm plus enough CELO for the relevant operational model.

The normal payment flow is:

1. The agent confirms recipient, amount, token, network, destination, and purpose.
2. It calls `get_agent_wallet` and `get_balance`; insufficient balance stops the flow before approval.
3. It parses invoices or x402 requirements when relevant, and uses `quote_payment_route` for direct or LI.FI remittance routes.
4. It calls `prepare_payment`, shows max spend, minimum output, exact native value, fee cap, deadline, target, and calldata hash.
5. The Owner signs the exact EIP-712 authorization. The Executor can submit only that signed authorization.
6. The agent calls `execute_payment`, then `track_payment`, and uses `list_payment_events` for the receipt and audit history.

Vague confirmations such as “yes” never authorize execution. Exact approval text and an owner signature are separate safeguards; nonce replay protection, deadlines, token and target allowlists, spend caps, and audit events remain enforced.

## x402 Service Purchases

If the user wants a paid service without a URL, call `search_x402_services`, choose a Bazaar result, and call `prepare_x402_service_request`. Pass both its x402 v2 `PAYMENT-REQUIRED` response and exact request to `parse_x402_payment_required`; the URL, method, body, and safe headers are bound into the owner-signed purpose. Preserve `paymentType: "X402_PAYMENT"`, then use the same Review & Sign flow. If no request is supplied, the secure fallback is GET with no body.

After `track_payment` returns `COMPLETED`, call `retry_x402_request`. AgentPay attaches its receipt proof, reads the v2 `PAYMENT-RESPONSE` header, and carries `payment-identifier` idempotency data when the service advertises it. This receipt bridge works only with services that support the AgentPay proof flow.

Self-hosted operators expose the public MCP endpoint with `agentpay serve-http`. The Celo x402 seller gate uses `AGENTPAY_A2MCP_PAYMENT_ENABLED`, canonical Celo USDC, `eip155:42220` or `eip155:11142220`, and `AGENTPAY_CELO_X402_API_KEY` for the hosted Celo facilitator. `/healthz` remains free.

## Components

- `apps/mcp-server/` — MCP tools, OAuth/SIWE boundary, Celo RPC adapters, x402, LI.FI, Supabase repositories, and production readiness gates.
- `apps/setup-web/` — setup and Review & Sign web flow.
- `packages/shared/` — Celo chain/token metadata, schemas, typed authorization, invoice, and x402 helpers.
- `packages/cli/` — the `@agentpay-ai/agentpay-celo` installer and runtime templates.
- `packages/skill/` — source for the installed `skills/agentpay/SKILL.md` instructions.
- `contracts/` — non-upgradeable owner-signed smart accounts and Foundry tests.
- `supabase/migrations/` — tenant, payment, audit, OAuth, canary, and Celo boundary migrations.

## Self-Hosted Configuration

Core staging/local values are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CELO_RPC_URL`, and `EXECUTOR_PRIVATE_KEY`. Network switching uses `CELO_MAINNET_RPC_URL` and `CELO_SEPOLIA_RPC_URL`. Setup also needs `SETUP_DEPLOYER_PRIVATE_KEY` and the V2 account bytecode.

Celo mainnet production is isolated and readiness-gated. Use `AGENTPAY_ENVIRONMENT=production`, `AGENTPAY_HOME_CHAIN_ID=42220`, `AGENTPAY_ACCOUNT_VERSION=v2`, `SUPABASE_PRODUCTION_URL`, `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`, `CELO_MAINNET_RPC_URL=https://forno.celo.org`, and the tracked Celo mainnet manifest. Generic or Sepolia aliases are rejected by the production surface.

The bounded first canary is canonical Celo USDC only, one lifecycle, no route target, and no silent expansion to USDT or USDm. Broader token and route support is enabled only after the canary gates pass.

Contract commands:

```bash
npm run contracts:deploy:celo
npm run contracts:deploy:celo:sepolia
```

These commands broadcast transactions and therefore require explicit operator approval and funded keys.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm run release:smoke
npm audit --audit-level=high
```

The repository keeps the existing chat-first installer contract: normal users install, return to chat, create a Celo Sepolia wallet, fund it, and pay. Mainnet account activation, external Supabase provisioning, DNS changes, contract deployment, npm publishing, and GitHub push are separate operator actions.
