export interface MainnetArtifactDigests {
  packageLockSha256: string;
  creationBytecodeKeccak256: string;
}

export function computeArtifactDigests(rootDir?: string): Promise<MainnetArtifactDigests>;
