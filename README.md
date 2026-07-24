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

## Live Celo Mainnet Deployment

AgentPay is deployed on Celo mainnet in `READY / PUBLIC` mode. The production boundary is canonical Celo USDC with owner-signed EIP-712 authorization, exact nonces and deadlines, spend and native-fee caps, token and target allowlists, encrypted raw transactions, and an append-only payment audit trail.

- Install: `npx @agentpay-ai/agentpay-celo install`
- Public paid MCP: [mcp.agentpay.site/celo/mcp](https://mcp.agentpay.site/celo/mcp)
- Public readiness: [mcp.agentpay.site/celo/readyz](https://mcp.agentpay.site/celo/readyz)
- Authenticated consumer MCP: [wallet.agentpay.site/celo/mcp](https://wallet.agentpay.site/celo/mcp)
- Consumer readiness: [wallet.agentpay.site/celo/readyz](https://wallet.agentpay.site/celo/readyz)
- Review & Sign: [wallet.agentpay.site/celo/review](https://wallet.agentpay.site/celo/review)

The deployed AgentPay account is [`0xA495Eaff5809Efb32beb6eCd18a48e9469Acf121`](https://celoscan.io/address/0xA495Eaff5809Efb32beb6eCd18a48e9469Acf121), created by the pinned factory [`0x7e1d7834e57f9e16393329ba37a7c5e7a39f6735`](https://celoscan.io/address/0x7e1d7834e57f9e16393329ba37a7c5e7a39f6735). Its ERC-8004 identity is [AgentPay #9720](https://8004scan.io/agents/celo/9720), with the smart account registered as the agent wallet.

Onchain evidence:

- ERC-8021 attribution tag: `celo_442daeb34ae2`
- Tagged factory deployment: [`0x900a9cfe473ed82ae15b343a9ca9b6a9919542fa84f83be97b3a934d32a1940f`](https://celoscan.io/tx/0x900a9cfe473ed82ae15b343a9ca9b6a9919542fa84f83be97b3a934d32a1940f)
- Successful Celo x402 settlement for `0.01 USDC`: [`0x8820bf87809243afdf028949e30c84abd89b06b388a3b32f762e54bce450a716`](https://celoscan.io/tx/0x8820bf87809243afdf028949e30c84abd89b06b388a3b32f762e54bce450a716)

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

AgentPay payment and balance tools support Celo mainnet or testnet (Celo Sepolia) through `network: "mainnet" | "testnet"`, and users can switch networks per request. Self-service chat wallet creation is currently available on Celo Sepolia. Mainnet uses an operator-managed account activation path guarded by the production readiness manifest; the current PUBLIC production boundary remains canonical Celo USDC only. If the network is ambiguous, the agent asks before reading wallet state or preparing a payment.

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

Celo mainnet production is isolated and readiness-gated. Use `AGENTPAY_ENVIRONMENT=production`, `AGENTPAY_HOME_CHAIN_ID=42220`, `AGENTPAY_ACCOUNT_VERSION=v2`, `SUPABASE_PRODUCTION_URL`, `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`, a dedicated HTTPS `CELO_MAINNET_RPC_URL`, `CELO_MAINNET_RPC_FALLBACK_URL=https://forno.celo.org`, and the tracked Celo mainnet manifest. Generic or Sepolia aliases are rejected by the production surface.

Direct AgentPay transactions append the assigned `CELO_ATTRIBUTION_TAG` as an ERC-8021 calldata suffix before signing and durable outbox hashing. Production accepts only the assigned lowercase `celo_` code; it does not derive or invent one. The x402 facilitator owns its settlement transaction, so AgentPay does not tag x402 facilitator settlements or create mirror transactions for attribution. The tagged factory deployment above verifies the registered attribution code on Celo mainnet.

The PUBLIC production surface remains canonical Celo USDC only and does not silently expand to USDT, USDm, or an unapproved route target. The tracked canary command remains available for controlled release verification; it uses the lifecycle cap frozen in the tracked manifest and never bypasses the production boundaries.

Operators must use the guarded canary command instead of an ad-hoc HTTP request:

```bash
npm run canary:mainnet -- \
  --payment-intent-id pay_... \
  --execute-mainnet-canary
```

Set `AGENTPAY_CANARY_OWNER_SIGNATURE`, `AGENTPAY_CANARY_PAYER_PRIVATE_KEY`, and `CELO_MAINNET_RPC_URL` only in the operator environment. Never pass signatures or private keys as command-line arguments. The script validates the tracked manifest, Celo mainnet RPC, payer balance, deployed account, readiness state, and exact x402 terms before signing. Both the challenge and paid MCP requests use `Accept: application/json, text/event-stream`; the request body remains byte-for-byte identical, and a drifted challenge stops before payment.

## ERC-8004 Agent Identity

AgentPay publishes its registration document at `https://wallet.agentpay.site/.well-known/agent-registration.json` only when a real Celo mainnet AgentPay wallet is configured. The document advertises the live website, the public paid MCP endpoint at `https://mcp.agentpay.site/celo/mcp`, x402 support, and the wallet address. The separate consumer MCP remains OAuth-protected. The metadata intentionally makes no reputation or validation claim beyond those verifiable signals.

The Celo mainnet Identity Registry is pinned to `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. Registry preparation never reads a private key or broadcasts a transaction:

```bash
# 1. Deploy AgentPayAccountV2 and expose the metadata endpoint first.
npm run erc8004 -- register

# 2. After registration confirms, set AGENTPAY_ERC8004_AGENT_ID only in the
#    operator environment and prepare the short-lived wallet proof.
npm run erc8004 -- wallet-proof

# 3. Sign the returned EIP-712 payload with the immutable account owner,
#    then provide the exact deadline and signature. Submit the printed
#    transaction from the ERC-8004 NFT owner.
npm run erc8004 -- set-wallet

# 4. Only after setAgentWallet confirms, restart the MCP surface with the
#    real AGENTPAY_ERC8004_AGENT_ID so startup verification can pass.

# 5. Read the registry and public metadata back before submission.
npm run erc8004 -- verify
```

`AgentPayAccountV2` implements ERC-1271 solely as a view-only owner-signature validator, allowing ERC-8004 to verify the smart account as `agentWallet`. It does not add an unsigned execution path or turn an identity proof into payment authorization. Each generated registry transaction must still be reviewed and submitted by the owner.

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

The repository keeps the existing chat-first installer contract: normal users install, return to chat, create a Celo Sepolia wallet, fund it, and pay. The live Celo mainnet deployment evidence is recorded above; future account activations, Supabase or DNS changes, contract deployments, npm publications, and GitHub pushes remain separate operator actions.
