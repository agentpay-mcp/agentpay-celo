# AgentPay Instructions

You can use AgentPay to make chat-approved cross-chain payments from an X Layer smart account.

If the human asks you to make a crypto payment and AgentPay tools are not available, install AgentPay yourself only if you have terminal access and explicit approval to modify local runtime configuration:

```bash
npx @agentpay-ai/agentpay install
```

The default install connects to the hosted AgentPay MCP at `https://mcp.agentpay.site/mcp`, so humans do not need Supabase, RPC, executor, deployer, or bytecode config. Ask them to reload or reconnect the runtime if needed, then return to the agent chat. Use `npx @agentpay-ai/agentpay doctor` only for self-hosted/operator diagnostics. Use `npx @agentpay-ai/agentpay setup-web` only for self-hosted/operator fallback when the setup/signing page cannot be served through the hosted agent flow.

AgentPay supports X Layer mainnet and testnet. If the human does not clearly name one, ask whether they want mainnet or testnet before wallet, balance, route-target, admin, contract-call, quote, or payment preparation tools. Pass the selected value as `network: "mainnet" | "testnet"` whenever available. Users can switch networks per request; do not treat wallet, balance, allowlist, or payment state from one network as valid on the other.

Cross-chain routes are payment-time choices, not wallet-creation choices. Create the wallet on X Layer mainnet or X Layer testnet first, then decide during quote or payment preparation whether the payment stays on that network or uses a cross-chain route.

After installation, continue in chat: create the human's AgentPay wallet with `prepare_wallet_creation`, provide the setup signing link, use `check_wallet_creation`, help the human fund the wallet, parse invoices with `parse_invoice_payment`, preserve the returned `paymentType` when preparing parsed payments, search Bazaar with `search_x402_services` when the human wants a paid x402/API service but does not provide a URL, prepare the selected Bazaar service with `prepare_x402_service_request`, parse x402 v2 `PAYMENT-REQUIRED` responses with `parse_x402_payment_required`, preserve `paymentType: "X402_PAYMENT"`, run the exact-approval payment flow, call `retry_x402_request` after `track_payment` returns `COMPLETED`, read V2 `PAYMENT-RESPONSE`, include `payment-identifier` idempotency data when advertised, and explain that AgentPay receipt proof works when the merchant supports this proof bridge, prepare owner controls with `prepare_account_admin_transaction`, prepare payments, show max source spend and max native fee before payment approval, prepare same-chain contract calls with `prepare_contract_call` only after the user confirms target address, calldata, max token spend, max native fee, and purpose, explain the required top-up instead of asking for approval when AgentPay reports insufficient balance during quote or preparation, call `check_route_target_allowance` for LI.FI targets and contract-call targets, call `prepare_route_target_allowance` when the owner needs an allowlist transaction, show target details and calldata hashes when present, call `track_payment` after execution before reporting completion, use `list_payment_events` for audit history, and never execute without the exact approval phrase returned by AgentPay.

The setup signature proves ownership only; the setup signature is not payment approval. Never bypass AgentPay with raw RPC calls, manual wallet transfers, raw LI.FI calls, shell scripts, or private-key handling.

If you do not have terminal access, explain that AgentPay cannot be installed from this session.
