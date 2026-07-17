# @agentpay-ai/agentpay

AgentPay installs MCP tools and runtime instructions for owner-authorized Celo payments. Hosted chat mode connects to the authenticated consumer endpoint at `https://wallet.agentpay.site/mcp`; the separate paid public execution endpoint at `https://mcp.agentpay.site/mcp` is used only after Review & Sign. Normal users do not manage Supabase, RPC, executor, deployer, or bytecode configuration.

## Install

```bash
npx @agentpay-ai/agentpay install
```

Then return to your agent chat:

```text
Create an AgentPay wallet for me on Celo Sepolia.
Pay 5 USDT to 0x... on Celo Sepolia for invoice INV-001.
```

No user secrets are required for hosted mode. Payment and balance tools support Celo mainnet or testnet (Celo Sepolia) through `network: "mainnet" | "testnet"`; the agent asks when the choice is ambiguous, and users can switch networks per request. Self-service chat wallet creation is currently available on Celo Sepolia, while mainnet uses an operator-managed, readiness-gated account path. Cross-chain routes are selected at payment time after a Celo wallet exists.

AgentPay covers direct send payments, invoice payments, x402 purchases, batch payout workflows, remittance/swap-and-pay routes, and agent-to-agent payments. Every executable payment still requires the owner to sign the exact EIP-712 authorization.

For x402 discovery without a URL, the agent uses `search_x402_services` and `prepare_x402_service_request`. After payment completes, `retry_x402_request` attaches AgentPay receipt proof, reads `PAYMENT-RESPONSE`, and passes `payment-identifier` idempotency data when supported.

## Commands

```bash
agentpay install
agentpay install --self-hosted
agentpay mcp
agentpay serve-http
agentpay setup-web
agentpay doctor
```

`install` detects the target runtime. `--self-hosted` additionally writes a local config and pinned V2 account bytecode. `doctor` and `setup-web` are operator diagnostics/fallbacks, not the normal hosted-user flow.

The public Celo x402 seller gate is enabled with `AGENTPAY_A2MCP_PAYMENT_ENABLED=true`, pay-to, price, network, asset, and `AGENTPAY_CELO_X402_API_KEY`. `/healthz` remains free.

Self-hosted staging/local configuration uses:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`;
- `CELO_RPC_URL`, plus optional `CELO_MAINNET_RPC_URL` and `CELO_SEPOLIA_RPC_URL`;
- `EXECUTOR_PRIVATE_KEY`;
- setup bytecode and `SETUP_DEPLOYER_PRIVATE_KEY` when setup-web is enabled.

Optional values include `SETUP_WEB_URL`, `LIFI_API_KEY`, `X402_BAZAAR_FACILITATOR_URL`, Celo token overrides, Review & Sign secrets, and the Celo x402 seller variables.

Production uses the isolated Celo mainnet boundary: `AGENTPAY_ENVIRONMENT=production`, `AGENTPAY_HOME_CHAIN_ID=42220`, `CELO_MAINNET_RPC_URL=https://forno.celo.org`, production-only Supabase aliases, the V2 bytecode pin, and a tracked readiness manifest.
