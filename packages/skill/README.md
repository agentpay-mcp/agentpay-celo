# @agentpay-ai/skill

AgentPay runtime instructions for AI coding agents.

This package contains the AgentPay `SKILL.md` and OpenAI metadata used by `npx @agentpay-ai/agentpay install`. Most users should install the CLI instead of installing this package directly:

```bash
npx @agentpay-ai/agentpay install
```

After installation, users should return to their agent chat and ask for wallet creation or payment there. The agent uses AgentPay MCP tools to create setup links, prepare payments, request exact approval phrases, execute after approval, and track status.

## Contents

- `SKILL.md` defines AgentPay payment, setup, approval, and safety workflows.
- `agents/openai.yaml` provides Codex/OpenAI agent metadata.

## Safety Notes

The skill requires exact human approval phrases before payment execution, keeps wallet setup separate from payment approval, and instructs agents not to expose secrets.
