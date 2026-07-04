# AgentPay

Chat-approved stablecoin payments for AI agents.

AgentPay installs MCP tools, runtime instructions, smart account bytecode, and a local setup/signing web flow. Agents can prepare BNB Chain stablecoin payments, while the human keeps approval authority in chat.

## Quick Start

```bash
npx @agentpay-ai/agentpay install
```

Use `--runtime codex|claude|cursor|generic|hermes` to choose a runtime explicitly:

```bash
npx @agentpay-ai/agentpay install --runtime codex
```

The installer writes `~/.agentpay/config.json`, MCP runtime files, `skills/agentpay/SKILL.md`, and `AgentPayAccount.bin`.

After install, reload or reconnect your agent runtime if needed, then return to your agent chat. From there, ask naturally:

```txt
Create an AgentPay wallet for me on BNB testnet.
```

or:

```txt
Pay 5 USDT to 0x... on BNB testnet for invoice INV-001.
```

The agent should use AgentPay tools in chat to create the wallet setup link, check wallet creation, prepare payments, request the exact approval phrase, execute after exact approval, and track status.

## Commands

- `agentpay install` creates local AgentPay runtime files.
- `agentpay mcp` starts the AgentPay MCP server over stdio.
- `agentpay doctor` is a diagnostic check for required config without printing secrets.
- `agentpay setup-web` is a fallback way to serve the setup/signing web server when the agent cannot start it for you.

## Required Configuration

Fill the generated config or provide equivalent environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BNB_RPC_URL`
- `EXECUTOR_PRIVATE_KEY`
- `SETUP_DEPLOYER_PRIVATE_KEY` for setup web

Optional values include `SETUP_WEB_URL`, `LIFI_API_KEY`, `AGENTPAY_ACCOUNT_BYTECODE_PATH`, `AGENTPAY_INITIAL_ROUTE_TARGETS`, and BNB testnet token overrides.

## Safety Model

- Setup signatures prove wallet ownership only. They do not approve payments.
- Payments require exact chat approval before execution.
- The smart account enforces token and route-target allowlists, nonces, deadlines, max spend, max native fee, calldata hash checks, and allowance reset after guarded calls.
- Keep service role keys and private keys server-side. Never paste secrets into chat.

## Packages

This CLI installs and wires the AgentPay package set:

- `@agentpay-ai/skill`
- `@agentpay-ai/shared`
- `@agentpay-ai/mcp-server`
- `@agentpay-ai/setup-web`

See the repository README for development, contract, and release commands.
