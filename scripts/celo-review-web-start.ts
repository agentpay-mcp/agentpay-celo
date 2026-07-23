import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { createSupabaseAgentPayRepositoriesFromConfig } from "../apps/mcp-server/src/services/supabase.ts";
import { startReviewOnlyWebServer } from "../apps/setup-web/src/server.ts";

const commitPattern = /^[0-9a-f]{40}$/i;
const digestPattern = /^[0-9a-f]{64}$/;

export interface CeloReviewWebEnvironment {
  supabaseUrl: string;
  serviceRoleKey: string;
  projectRef: string;
  reviewTokenSecret: string;
  reviewUrl: string;
  manifestPath: string;
  manifestSha256: string;
  releaseCommit: string;
}

export function parseCeloReviewWebEnvironment(
  env: Record<string, string | undefined>,
): CeloReviewWebEnvironment {
  const value = (name: string) => env[name]?.trim() ?? "";
  const projectRef = value("AGENTPAY_SETUP_SUPABASE_PROJECT_REF");
  const result: CeloReviewWebEnvironment = {
    supabaseUrl: value("SUPABASE_PRODUCTION_URL"),
    serviceRoleKey: value("SUPABASE_PRODUCTION_SERVICE_ROLE_KEY"),
    projectRef,
    reviewTokenSecret: value("AGENTPAY_REVIEW_TOKEN_SECRET"),
    reviewUrl: value("SETUP_WEB_URL"),
    manifestPath: value("AGENTPAY_MAINNET_MANIFEST_PATH"),
    manifestSha256: value("AGENTPAY_REVIEW_MANIFEST_SHA256"),
    releaseCommit: value("AGENTPAY_RELEASE_COMMIT"),
  };
  const forbiddenSigningSecrets = Object.entries(env).some(([name, rawValue]) =>
    /(?:PRIVATE_KEY|RAW_TX_ENCRYPTION_KEY)$/.test(name) && Boolean(rawValue?.trim())
  );
  const invalid =
    value("AGENTPAY_ENVIRONMENT") !== "production" ||
    value("AGENTPAY_HOME_CHAIN_ID") !== "42220" ||
    value("AGENTPAY_ACCOUNT_VERSION") !== "v2" ||
    value("AGENTPAY_EXECUTION_MODE") !== "OFF" ||
    value("AGENTPAY_A2MCP_PAYMENT_ENABLED") !== "false" ||
    !/^[a-z0-9]{20}$/.test(projectRef) ||
    result.supabaseUrl !== `https://${projectRef}.supabase.co` ||
    !result.serviceRoleKey ||
    result.reviewTokenSecret.length < 32 ||
    result.reviewUrl !== "https://wallet.agentpay.site/celo/review" ||
    !result.manifestPath.startsWith("/") ||
    !digestPattern.test(result.manifestSha256) ||
    !commitPattern.test(result.releaseCommit) ||
    forbiddenSigningSecrets;

  if (invalid) throw new Error("Celo review-only environment is incomplete or over-privileged.");
  return result;
}

export function assertCeloReviewArtifacts(input: {
  releaseRoot: string;
  environment: CeloReviewWebEnvironment;
}): void {
  if (!input.releaseRoot.startsWith("/") || basename(input.releaseRoot) !== input.environment.releaseCommit) {
    throw new Error("Celo review release root does not match the pinned commit.");
  }
  const manifest = JSON.parse(readFileSync(input.environment.manifestPath, "utf8")) as unknown;
  const manifestSha256 = createHash("sha256").update(canonicalJson(manifest)).digest("hex");
  if (manifestSha256 !== input.environment.manifestSha256) {
    throw new Error("Celo review manifest digest does not match the production environment.");
  }
}

export async function startCeloReviewWebServer(options: {
  env?: Record<string, string | undefined>;
  releaseRoot?: string;
  port?: number;
} = {}): Promise<{ close(): Promise<void>; url: string }> {
  const environment = parseCeloReviewWebEnvironment(options.env ?? process.env);
  const releaseRoot = options.releaseRoot ?? process.cwd();
  assertCeloReviewArtifacts({ releaseRoot, environment });
  const repositories = createSupabaseAgentPayRepositoriesFromConfig({
    supabaseUrl: environment.supabaseUrl,
    serviceRoleKey: environment.serviceRoleKey,
  });

  return startReviewOnlyWebServer({
    clock: () => new Date(),
    paymentReviews: repositories.paymentReviews,
    paymentIntents: repositories.paymentIntents,
    reviewTokenSecret: environment.reviewTokenSecret,
  }, {
    hostname: "127.0.0.1",
    port: options.port ?? 3103,
    basePath: "/celo",
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void startCeloReviewWebServer()
    .then((server) => {
      console.log(`AgentPay Celo Review & Sign listening at ${server.url}`);
      const close = async () => {
        await server.close();
        process.exit(0);
      };
      process.once("SIGTERM", close);
      process.once("SIGINT", close);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Celo review-only server failed to start.");
      process.exitCode = 1;
    });
}
