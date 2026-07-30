# @agentpay-ai/agentpay-celo

AgentPay installs MCP tools and runtime instructions for owner-authorized Celo payments. The visible product remains AgentPay; the Celo installer uses the isolated technical names `~/.agentpay-celo`, skill `agentpay-celo`, MCP entry `agentpay-celo`, and binary `agentpay-celo` so it can coexist with the X Layer implementation.

## Install

For Codex:

```bash
npx -y @agentpay-ai/agentpay-celo@latest install --runtime codex
codex mcp login agentpay-celo
```

The install command adds the Codex MCP entry and installs the skill under `~/.agents/skills/agentpay-celo`. It does not overwrite an existing `~/.agentpay` tree or MCP entry named `agentpay`. Restart/reconnect Codex or open a new task after installation and OAuth.

For Claude, Cursor, Hermes, or a manual integration, replace `codex` with the explicit runtime:

```bash
npx -y @agentpay-ai/agentpay-celo@latest install --runtime claude
npx -y @agentpay-ai/agentpay-celo@latest install --runtime cursor
npx -y @agentpay-ai/agentpay-celo@latest install --runtime hermes
npx -y @agentpay-ai/agentpay-celo@latest install --runtime generic
```

When `--runtime` is omitted, detection succeeds only when one project marker identifies a runtime. Otherwise the installer fails closed and asks for an explicit runtime.

Then return to your agent chat:

```text
Create an AgentPay wallet for me on Celo Sepolia.
Pay 5 USDT to 0x... on Celo Sepolia for invoice INV-001.
```

No user secrets are required for hosted mode. Hosted chat connects to the authenticated consumer endpoint at `https://wallet.agentpay.site/celo/mcp`; payment execution occurs only on the separate paid public endpoint at `https://mcp.agentpay.site/celo/mcp` after owner Review & Sign.

The OAuth, setup, and Review & Sign pages request the required Celo network automatically. They use `wallet_switchEthereumChain` first and add the official Celo mainnet or Sepolia network only when the wallet reports that it is unknown. The owner must still confirm the wallet prompt; rejecting it never advances to signing.

Payment and balance tools support Celo mainnet or testnet (Celo Sepolia) through `network: "mainnet" | "testnet"`. Users can switch networks per request. Self-service chat wallet creation is currently available on Celo Sepolia, while mainnet uses an operator-managed, readiness-gated account path. Cross-chain routes are selected at payment time after a Celo wallet exists.

AgentPay covers direct sends, invoice payments, x402 purchases, batch payouts, remittance/swap-and-pay routes, and agent-to-agent payments. For x402 discovery without a URL, the agent uses `search_x402_services` and `prepare_x402_service_request`. After payment completes, `retry_x402_request` attaches AgentPay receipt proof, reads `PAYMENT-RESPONSE`, and passes `payment-identifier` idempotency data when supported.

## Commands

```bash
agentpay-celo install --runtime codex
agentpay-celo install --runtime codex --self-hosted
agentpay-celo mcp
agentpay-celo serve-http
agentpay-celo setup-web
agentpay-celo doctor
```

`--self-hosted` writes a local config and pinned V2 account bytecode under `~/.agentpay-celo`. A custom `--output-dir` is carried into the generated `AGENTPAY_CONFIG` path. Reinstalling with `--force` preserves existing secrets and unknown config keys.

`doctor`, `setup-web`, `mcp`, and `serve-http` are operator surfaces, not the normal hosted-user flow. The public Celo x402 seller gate is enabled with `AGENTPAY_A2MCP_PAYMENT_ENABLED=true`, pay-to, price, network, asset, and `AGENTPAY_CELO_X402_API_KEY`. `/healthz` remains free.

Self-hosted staging/local configuration uses:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`;
- `CELO_RPC_URL`, plus optional `CELO_MAINNET_RPC_URL` and `CELO_SEPOLIA_RPC_URL`;
- `EXECUTOR_PRIVATE_KEY`;
- setup bytecode and `SETUP_DEPLOYER_PRIVATE_KEY` when setup-web is enabled.

Optional values include `SETUP_WEB_URL`, `LIFI_API_KEY`, `X402_BAZAAR_FACILITATOR_URL`, Celo token overrides, Review & Sign secrets, and the Celo x402 seller variables.

Production uses the isolated Celo mainnet boundary: `AGENTPAY_ENVIRONMENT=production`, `AGENTPAY_HOME_CHAIN_ID=42220`, a dedicated HTTPS primary `CELO_MAINNET_RPC_URL`, `CELO_MAINNET_RPC_FALLBACK_URL=https://forno.celo.org`, production-only Supabase aliases, the V2 bytecode pin, and a tracked readiness manifest.
