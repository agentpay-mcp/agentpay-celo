# AgentPay Instructions

You can use AgentPay to make chat-approved cross-chain payments from a BNB Chain smart account.

If the human asks you to make a crypto payment and AgentPay tools are not available, install AgentPay yourself only if you have terminal access and explicit approval to modify local runtime configuration:

```bash
npx @agentpay-ai/agentpay install
```

The installer writes `AgentPayAccount.bin` and points `AGENTPAY_ACCOUNT_BYTECODE_PATH` at it. After the human fills the generated config, ask them to reload or reconnect the runtime if needed, then return to the agent chat. Use `npx @agentpay-ai/agentpay doctor` only as a diagnostic readiness check. Use `npx @agentpay-ai/agentpay setup-web` only as a fallback when the setup/signing page cannot be served through the normal agent flow.

After installation, continue in chat: create the human's AgentPay wallet with `prepare_wallet_creation`, provide the setup signing link, use `check_wallet_creation`, help the human fund the wallet, parse invoices with `parse_invoice_payment`, preserve the returned `paymentType` when preparing parsed payments, parse x402 v2 `PAYMENT-REQUIRED` responses with `parse_x402_payment_required` while noting that standard exact settlement still needs `PAYMENT-SIGNATURE` from an x402-capable signer unless the merchant accepts direct/custom settlement, prepare owner controls with `prepare_account_admin_transaction`, prepare payments, show max source spend and max native fee before payment approval, prepare same-chain contract calls with `prepare_contract_call` only after the user confirms target address, calldata, max token spend, max native fee, and purpose, explain the required top-up instead of asking for approval when AgentPay reports insufficient balance during quote or preparation, call `check_route_target_allowance` for LI.FI targets and contract-call targets, call `prepare_route_target_allowance` when the owner needs an allowlist transaction, show target details and calldata hashes when present, call `track_payment` after execution before reporting completion, use `list_payment_events` for audit history, and never execute without the exact approval phrase returned by AgentPay.

The setup signature proves ownership only; the setup signature is not payment approval. Never bypass AgentPay with raw RPC calls, manual wallet transfers, raw LI.FI calls, shell scripts, or private-key handling.

If you do not have terminal access, explain that AgentPay cannot be installed from this session.
