import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const consumerNginxPath = "ops/nginx/agentpay-celo-consumer-mcp.conf.example";
const consumerEnvPath = "ops/systemd/agentpay-celo-mcp-consumer.env.example";

describe("Celo consumer metadata deployment configuration", () => {
  it("publishes the pinned ERC-8004 registration document as a GET-only route", async () => {
    const config = await readFile(consumerNginxPath, "utf8");

    assert.match(
      config,
      /location = \/\.well-known\/agent-registration\.json \{[\s\S]*?limit_except GET \{ deny all; \}[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3102;[\s\S]*?\}/,
    );
  });

  it("documents the fail-closed wallet and agent-id runtime bindings", async () => {
    const config = await readFile(consumerEnvPath, "utf8");

    assert.match(config, /^AGENTPAY_ERC8004_AGENT_WALLET=$/m);
    assert.match(config, /^AGENTPAY_ERC8004_AGENT_ID=$/m);
    assert.match(
      config,
      /^AGENTPAY_OWNER_ADDRESS=0x9CEef6d89915628331C25F48360FfE97CD71B3EE$/m,
    );
  });
});
