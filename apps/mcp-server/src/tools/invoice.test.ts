import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseInvoicePaymentForAgent } from "./invoice.ts";

describe("parseInvoicePaymentForAgent", () => {
  it("returns normalized payment fields for prepare_payment", async () => {
    const output = await parseInvoicePaymentForAgent({
      invoice: [
        "Invoice ID: inv_456",
        "Recipient: 0x1111111111111111111111111111111111111111",
        "Destination Chain: Base",
        "Token: USDC",
        "Amount: 10",
        "Purpose: design bounty",
      ].join("\n"),
    });

    assert.deepEqual(output, {
      status: "PARSED",
      invoiceId: "inv_456",
      paymentInput: {
        recipientAddress: "0x1111111111111111111111111111111111111111",
        destinationChainId: 8453,
        destinationChain: "Base",
        destinationTokenSymbol: "USDC",
        amountOut: "10",
        purpose: "design bounty",
        sourceTokenSymbol: "USDC",
        paymentType: "INVOICE_PAYMENT",
      },
      instructionToAgent:
        "Review these invoice payment fields with the user, then call prepare_payment with paymentInput if they match the invoice.",
    });
  });
});
