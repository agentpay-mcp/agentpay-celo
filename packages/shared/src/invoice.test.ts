import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseInvoicePayment } from "./invoice.ts";

describe("parseInvoicePayment", () => {
  it("parses structured AgentPay invoice JSON into payment fields", () => {
    const parsed = parseInvoicePayment({
      invoice: JSON.stringify({
        invoiceId: "inv_123",
        recipientAddress: "0x1111111111111111111111111111111111111111",
        destinationChainId: 8453,
        destinationTokenSymbol: "USDC",
        amountOut: "10.50",
        purpose: "design bounty",
        sourceTokenSymbol: "USDC",
      }),
    });

    assert.deepEqual(parsed, {
      invoiceId: "inv_123",
      recipientAddress: "0x1111111111111111111111111111111111111111",
      destinationChainId: 8453,
      destinationChain: "Base",
      destinationTokenSymbol: "USDC",
      amountOut: "10.50",
      purpose: "design bounty",
      sourceTokenSymbol: "USDC",
      paymentType: "INVOICE_PAYMENT",
    });
  });

  it("parses key-value invoice text with chain names and default source token", () => {
    const parsed = parseInvoicePayment({
      invoice: [
        "Invoice ID: inv_456",
        "Recipient: 0x1111111111111111111111111111111111111111",
        "Destination Chain: Base",
        "Token: USDT",
        "Amount: 25",
        "Memo: content license",
      ].join("\n"),
    });

    assert.deepEqual(parsed, {
      invoiceId: "inv_456",
      recipientAddress: "0x1111111111111111111111111111111111111111",
      destinationChainId: 8453,
      destinationChain: "Base",
      destinationTokenSymbol: "USDT",
      amountOut: "25",
      purpose: "content license",
      sourceTokenSymbol: "USDC",
      paymentType: "INVOICE_PAYMENT",
    });
  });

  it("uses invoice id as purpose when no memo is provided", () => {
    const parsed = parseInvoicePayment({
      invoice: [
        "Invoice ID: inv_789",
        "To: 0x1111111111111111111111111111111111111111",
        "Chain ID: 42220",
        "Currency: USDC",
        "Amount Due: 3.25",
      ].join("\n"),
    });

    assert.equal(parsed.purpose, "Invoice inv_789");
  });

  it("parses Celo aliases and preserves the USDm symbol casing", () => {
    const parsed = parseInvoicePayment({
      invoice: [
        "Invoice ID: inv_celo",
        "To: 0x1111111111111111111111111111111111111111",
        "Chain: Celo Mainnet",
        "Currency: USDm",
        "Amount: 4.25",
      ].join("\n"),
    });

    assert.equal(parsed.destinationChainId, 42220);
    assert.equal(parsed.destinationChain, "Celo");
    assert.equal(parsed.destinationTokenSymbol, "USDm");
    assert.equal(parsed.sourceTokenSymbol, "USDC");
  });

  it("rejects invoices missing required payment fields", () => {
    assert.throws(
      () =>
        parseInvoicePayment({
          invoice: "Invoice ID: inv_missing\nAmount: 10\nToken: USDC",
        }),
      /Invalid invoice payment fields/,
    );
  });
});
