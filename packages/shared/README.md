# @agentpay-ai/shared

Shared AgentPay schemas and helpers:

- Celo mainnet and Celo Sepolia chain metadata;
- canonical Celo USDC, USDT, and USDm addresses and decimals;
- balance, invoice, x402, and payment-intent validation;
- direct and route EIP-712 authorization builders;
- exact approval, nonce, deadline, route, and receipt helpers used by the MCP and setup surfaces.

The source home-chain schemas accept only Celo mainnet (`42220`) and Celo Sepolia (`11142220`). Destination metadata can still describe supported cross-chain remittance assets without turning those chains into AgentPay home chains.
