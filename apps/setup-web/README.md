# @agentpay-ai/setup-web-celo

AgentPay setup-web serves wallet setup and tenant-scoped Review & Sign pages for Celo. It deploys the non-upgradeable `AgentPayAccountV2`, verifies the setup owner signature, and stores only the payment review handoff needed to return a verified EIP-712 signature.

Required self-hosted staging values include `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CELO_RPC_URL`, `SETUP_DEPLOYER_PRIVATE_KEY`, and the V2 creation bytecode. Celo Sepolia defaults to canonical USDC, USDT, and USDm. Mainnet production deployment remains disabled at this web boundary and uses the dedicated Foundry/readiness path.

Review & Sign uses `AGENTPAY_REVIEW_TOKEN_SECRET` when configured, otherwise the existing service-role fallback. It never treats a setup signature, consumer session, x402 credential, or chat confirmation as payment authorization.
