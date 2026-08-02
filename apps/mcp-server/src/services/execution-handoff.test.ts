import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXECUTION_HANDOFF_PATH,
  createExecutionHandoffClient,
  createExecutionHandoffSignature,
  parseExecutionHandoffEnv,
  verifyExecutionHandoffSignature,
} from "./execution-handoff.ts";

const secret = ["handoff", "secret", "that", "is", "at", "least", "thirty-two", "bytes", "long"].join("-");
const body = JSON.stringify({
  jsonrpc: "2.0",
  id: "handoff-1",
  method: "tools/call",
  params: {
    name: "execute_payment",
    arguments: {
      paymentIntentId: "pay_handoff",
      signature: `0x${"11".repeat(65)}`,
    },
  },
});

describe("consumer execution handoff", () => {
  it("signs and verifies the exact request body with a bounded timestamp", () => {
    const timestamp = 1_754_000_000;
    const signature = createExecutionHandoffSignature({ secret, timestamp, body });

    assert.match(signature, /^sha256=[a-f0-9]{64}$/);
    assert.equal(
      verifyExecutionHandoffSignature({ secret, timestamp, body, signature, now: timestamp * 1000 }),
      true,
    );
    assert.equal(
      verifyExecutionHandoffSignature({ secret, timestamp, body: `${body} `, signature, now: timestamp * 1000 }),
      false,
    );
    assert.equal(
      verifyExecutionHandoffSignature({ secret, timestamp: timestamp - 301, body, signature, now: timestamp * 1000 }),
      false,
    );
  });

  it("parses an optional loopback handoff configuration and fails closed on partial or weak values", () => {
    assert.equal(parseExecutionHandoffEnv({}), undefined);
    assert.deepEqual(
      parseExecutionHandoffEnv({
        AGENTPAY_INTERNAL_EXECUTION_URL: `http://127.0.0.1:3101${EXECUTION_HANDOFF_PATH}`,
        AGENTPAY_INTERNAL_EXECUTION_SECRET: secret,
      }),
      {
        url: `http://127.0.0.1:3101${EXECUTION_HANDOFF_PATH}`,
        secret,
        maxSkewSeconds: 300,
      },
    );
    assert.throws(
      () => parseExecutionHandoffEnv({ AGENTPAY_INTERNAL_EXECUTION_URL: "http://127.0.0.1:3101/internal" }),
      /AGENTPAY_INTERNAL_EXECUTION_SECRET/i,
    );
    assert.throws(
      () => parseExecutionHandoffEnv({
        AGENTPAY_INTERNAL_EXECUTION_URL: "https://executor.example/internal",
        AGENTPAY_INTERNAL_EXECUTION_SECRET: "short",
      }),
      /AGENTPAY_INTERNAL_EXECUTION_SECRET/i,
    );
    assert.throws(
      () => parseExecutionHandoffEnv({
        AGENTPAY_INTERNAL_EXECUTION_URL: "http://executor.example/internal",
        AGENTPAY_INTERNAL_EXECUTION_SECRET: secret,
      }),
      /AGENTPAY_INTERNAL_EXECUTION_URL/i,
    );
  });

  it("posts a canonical JSON-RPC handoff and returns the executor result", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createExecutionHandoffClient(
      {
        url: `http://127.0.0.1:3101${EXECUTION_HANDOFF_PATH}`,
        secret,
        maxSkewSeconds: 300,
      },
      async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "handoff-1",
            result: {
              paymentIntentId: "pay_handoff",
              status: "EXECUTING",
              sourceTxHash: `0x${"22".repeat(32)}`,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      () => 1_754_000_000_000,
      () => "handoff-1",
    );

    const result = await client.execute({
      paymentIntentId: "pay_handoff",
      signature: `0x${"11".repeat(65)}`,
    });

    assert.deepEqual(result, {
      paymentIntentId: "pay_handoff",
      status: "EXECUTING",
      sourceTxHash: `0x${"22".repeat(32)}`,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, `http://127.0.0.1:3101${EXECUTION_HANDOFF_PATH}`);
    const sentBody = String(requests[0]?.init.body);
    assert.match(sentBody, /"method":"tools\/call"/);
    assert.match(sentBody, /"name":"execute_payment"/);
    assert.equal(requests[0]?.init.headers && new Headers(requests[0].init.headers).get("x-agentpay-handoff-timestamp"), "1754000000");
    assert.match(
      new Headers(requests[0]?.init.headers).get("x-agentpay-handoff-signature") ?? "",
      /^sha256=[a-f0-9]{64}$/,
    );
  });
});
