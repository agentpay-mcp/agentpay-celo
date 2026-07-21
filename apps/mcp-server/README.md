# @agentpay-ai/mcp-server-celo

AgentPay's MCP server exposes owner-authorized Celo payment tools over stdio or Streamable HTTP. It supports wallet setup, Celo USDC/USDT/USDm balances, direct payments, invoice parsing, LI.FI remittance routes, x402 service discovery and purchase, Review & Sign, execution, tracking, and audit events.

Run locally:

```bash
npm run start --workspace @agentpay-ai/mcp-server-celo
```

Core local/staging configuration is `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CELO_RPC_URL`, and `EXECUTOR_PRIVATE_KEY`. Per-request network switching can use `CELO_MAINNET_RPC_URL` and `CELO_SEPOLIA_RPC_URL`.

For the public Celo x402 seller gate on `/mcp`:

```bash
AGENTPAY_A2MCP_PAYMENT_ENABLED=true
AGENTPAY_A2MCP_PAYMENT_NETWORK=eip155:42220
AGENTPAY_A2MCP_PAYMENT_ASSET=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
AGENTPAY_CELO_X402_API_KEY=...
```

Unpaid calls receive HTTP `402` with `PAYMENT-REQUIRED`; verified calls are settled before the MCP result is served and return `PAYMENT-RESPONSE`. `/healthz` is never paywalled.

The buyer flow can search Bazaar with `search_x402_services`, prepare a result with `prepare_x402_service_request`, and pass both `paymentRequired` and the exact request to `parse_x402_payment_required`. The URL, method, body, and safe headers are bound into the owner-signed purpose before payment. After completion, `retry_x402_request` accepts only that request shape, attaches AgentPay receipt proof, and includes `payment-identifier` idempotency data when advertised.

Celo mainnet production uses only `AGENTPAY_ENVIRONMENT=production`, `AGENTPAY_HOME_CHAIN_ID=42220`, `AGENTPAY_ACCOUNT_VERSION=v2`, production-only Supabase aliases, and `CELO_MAINNET_RPC_URL=https://forno.celo.org`. Generic and Sepolia aliases are rejected. The bounded canary is pinned to canonical Celo USDC and the tracked Celo manifest; `/readyz` remains closed until the database identity, deployed contract, account history, x402 configuration, and durable canary checks all agree.

Production stdio is disabled. Setup-web production deployment stays separately gated, and all broadcast or external provisioning actions require explicit operator approval.
