import type { MainnetArtifactDigests } from "./mainnet-shadow-manifest.mjs";

export function assertMainnetCanaryManifest(
  manifest: unknown,
  options: { artifactDigests: MainnetArtifactDigests },
): unknown;
