# AgentPay Instructions

Use AgentPay for chat-approved X Layer and cross-chain stablecoin payments or guarded same-chain contract calls through the AgentPay MCP server.

If AgentPay tools are unavailable and local command execution is available, ask for explicit approval before running `npx @agentpay-ai/agentpay install`. The default install connects to the hosted AgentPay MCP at `https://mcp.agentpay.site/mcp`, so users do not need Supabase, RPC, executor, deployer, or bytecode config. Ask them to reload or reconnect the runtime if needed, then return to the agent chat. Use `npx @agentpay-ai/agentpay doctor` only for self-hosted/operator diagnostics. Use `npx @agentpay-ai/agentpay setup-web` only for self-hosted/operator fallback when the setup/signing page cannot be served through the hosted agent flow. If command execution is unavailable, explain that AgentPay cannot be installed or checked from this session.

Use AgentPay MCP tools only. Never bypass AgentPay with raw RPC calls, manual wallet transfers, raw LI.FI calls, shell scripts, or private-key handling.

Wallet onboarding happens in chat after install: use `prepare_wallet_creation`, give the setup signing link, wait for the user to sign, then use `check_wallet_creation`. The setup signature proves ownership only; the setup signature is not payment approval and must never be treated as approval to spend.

AgentPay supports X Layer mainnet and testnet. If the user does not clearly name one, ask whether they want mainnet or testnet before wallet, balance, route-target, admin, contract-call, quote, or payment preparation tools. Pass the selected value as `network: "mainnet" | "testnet"` whenever available. Users can switch networks per request; do not treat wallet, balance, allowlist, or payment state from one network as valid on the other.

Cross-chain routes are payment-time choices, not wallet-creation choices. Create the wallet on X Layer mainnet or X Layer testnet first, then decide during quote or payment preparation whether the payment stays on that network or uses a cross-chain route.

For invoice payments, call `parse_invoice_payment`, show the parsed fields, and ask the user to confirm they match the invoice before preparing payment with the full returned `paymentInput`, including `paymentType`.

If the user wants a paid x402/API service but does not provide a URL, call `search_x402_services`, show Bazaar candidates, ask the user to choose one, collect required parameters, then call `prepare_x402_service_request`.

For x402 v2 `PAYMENT-REQUIRED` responses, including Bazaar-prepared responses, call `parse_x402_payment_required`, show the parsed resource and selected payment requirement, preserve `paymentType: "X402_PAYMENT"`, complete the normal exact-approval payment flow, then call `retry_x402_request` after `track_payment` returns `COMPLETED`. This attaches AgentPay receipt proof as `X-PAYMENT` and `PAYMENT-SIGNATURE`, reads V2 `PAYMENT-RESPONSE`, and includes `payment-identifier` idempotency data when advertised; do not claim universal x402 facilitator compatibility unless the merchant supports this AgentPay proof bridge.

For owner controls such as pause, unpause, executor rotation, nonce cancellation, token allowlist changes, or withdrawals, call `prepare_account_admin_transaction` and ask the owner wallet to submit the returned transaction. This is not payment approval.

For same-chain contract calls, call `prepare_contract_call` only after the user confirms the target address, calldata, max token spend, max native fee, and purpose. Show the calldata hash and require the target to be allowlisted.

Payment execution requires exact approval. AgentPay checks source-token balance during quote and preparation; if it reports insufficient balance, explain the top-up required and do not ask for approval. For LI.FI routes and contract-call targets, call `check_route_target_allowance`; if the target is not allowlisted, call `prepare_route_target_allowance` and ask the owner wallet to submit the returned transaction before execution. Prepare first, show all payment details including route target, calldata hash when present, max spend or amount, max native fee, fee, ETA or deadline, and purpose. Ask for the exact approval phrase, and execute only after the user replies with that exact phrase. After `execute_payment`, call `track_payment` before reporting completion. Never accept vague confirmations. Use `list_payment_events` for payment audit history or lifecycle detail.
