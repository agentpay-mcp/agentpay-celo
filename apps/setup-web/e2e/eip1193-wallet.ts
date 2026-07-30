import type { Page } from "@playwright/test";

export interface MockWalletOptions {
  account: string;
  chainIdHex: string;
  expectedTypedData: unknown;
  signature: string;
  knownChainIds?: string[];
  rejectSignCount?: number;
  rejectSwitchCount?: number;
}

export async function installMockWallet(page: Page, options: MockWalletOptions): Promise<void> {
  await page.addInitScript((config) => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const listeners = new Map<string, Array<(value: unknown) => void>>();
    let account = config.account;
    let chainIdHex = config.chainIdHex;
    const knownChainIds = new Set([chainIdHex.toLowerCase(), ...(config.knownChainIds ?? []).map((value) => value.toLowerCase())]);
    let remainingSignRejections = config.rejectSignCount ?? 0;
    let remainingSwitchRejections = config.rejectSwitchCount ?? 0;

    const emit = (event: string, value: unknown) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(value);
      }
    };
    const provider = {
      async request(request: { method: string; params?: unknown[] }) {
        calls.push({ method: request.method, params: request.params });
        if (request.method === "eth_accounts" || request.method === "eth_requestAccounts") {
          return account ? [account] : [];
        }
        if (request.method === "eth_chainId") {
          return chainIdHex;
        }
        if (request.method === "wallet_switchEthereumChain") {
          const requestedChainId = String((request.params?.[0] as { chainId?: unknown } | undefined)?.chainId ?? "").toLowerCase();
          if (remainingSwitchRejections > 0) {
            remainingSwitchRejections -= 1;
            throw Object.assign(new Error("User rejected the network switch."), { code: 4001 });
          }
          if (!knownChainIds.has(requestedChainId)) {
            throw Object.assign(new Error("Unrecognized chain."), { code: 4902 });
          }
          chainIdHex = requestedChainId;
          emit("chainChanged", chainIdHex);
          return null;
        }
        if (request.method === "wallet_addEthereumChain") {
          const network = request.params?.[0] as { chainId?: unknown } | undefined;
          const requestedChainId = String(network?.chainId ?? "").toLowerCase();
          if (!requestedChainId) throw new Error("Missing add-chain identifier.");
          knownChainIds.add(requestedChainId);
          chainIdHex = requestedChainId;
          emit("chainChanged", chainIdHex);
          return null;
        }
        if (request.method === "eth_signTypedData_v4") {
          if (String(request.params?.[0] ?? "").toLowerCase() !== account.toLowerCase()) {
            throw new Error("Browser requested a signature from an unexpected account.");
          }
          if (remainingSignRejections > 0) {
            remainingSignRejections -= 1;
            throw new Error("User rejected the signing request.");
          }
          const typedData = JSON.parse(String(request.params?.[1] ?? "null"));
          if (JSON.stringify(typedData) !== JSON.stringify(config.expectedTypedData)) {
            throw new Error("Browser requested unexpected typed data.");
          }
          return config.signature;
        }
        throw new Error(`Unexpected wallet method: ${request.method}`);
      },
      on(event: string, listener: (value: unknown) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    };

    Object.defineProperty(window, "ethereum", { configurable: false, value: provider });
    Object.defineProperty(window, "__agentPayWallet", {
      configurable: false,
      value: {
        calls() {
          return calls.map((call) => ({ ...call }));
        },
        setAccount(nextAccount: string) {
          account = nextAccount;
          emit("accountsChanged", account ? [account] : []);
        },
        setChain(nextChainIdHex: string) {
          chainIdHex = nextChainIdHex;
          emit("chainChanged", chainIdHex);
        },
      },
    });
  }, options);
}

export function walletMethods(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __agentPayWallet: { calls(): Array<{ method: string }> } })
      .__agentPayWallet.calls().map((call) => call.method),
  );
}

export function setWalletChain(page: Page, chainIdHex: string): Promise<void> {
  return page.evaluate((nextChainIdHex) => {
    (window as unknown as { __agentPayWallet: { setChain(chainId: string): void } })
      .__agentPayWallet.setChain(nextChainIdHex);
  }, chainIdHex);
}

export function setWalletAccount(page: Page, account: string): Promise<void> {
  return page.evaluate((nextAccount) => {
    (window as unknown as { __agentPayWallet: { setAccount(accountAddress: string): void } })
      .__agentPayWallet.setAccount(nextAccount);
  }, account);
}
