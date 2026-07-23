import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fromDataSuffix, toDataSuffix, verifyTx } from "@celo/attribution-tags";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  concat,
  getAddress,
  getCreateAddress,
  isHexString,
  keccak256,
} from "ethers";

const CELO_MAINNET_CHAIN_ID = 42_220n;
const CELO_MAINNET_USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const POLICY_VERSION = "0x7ca42c75d0d0ce25c514495482839ca84b4d4e3e445080004653e98bdebeb16c";
const ATTRIBUTION_TAG_PATTERN = /^celo_[a-f0-9]{12}$/;
const DEFAULT_ARTIFACT_PATH = fileURLToPath(new URL(
  "../contracts/out/AgentPayCeloAccountFactoryV1.sol/AgentPayCeloAccountFactoryV1.json",
  import.meta.url,
));
const DEFAULT_OUTPUT_PATH = fileURLToPath(new URL(
  "../ops/deployments/celo-mainnet-factory.json",
  import.meta.url,
));

type FactoryArtifact = Readonly<{
  abi: unknown;
  bytecode: string | Readonly<{ object: string }>;
}>;

type Hex = `0x${string}`;

type FactoryDeploymentInput = Readonly<{
  executorAddress: string;
  ownerAddress: string;
  deployerAddress: string;
  attributionTag: string;
}>;

export type FactoryDeploymentEvidence = Readonly<{
  address: string;
  deploymentTxHash: string;
  deploymentBlock: number;
  runtimeCodeHash: string;
  executor: string;
  usdc: typeof CELO_MAINNET_USDC;
  policyVersion: typeof POLICY_VERSION;
}>;

export function validateFactoryDeploymentInput(input: FactoryDeploymentInput): FactoryDeploymentInput {
  const executorAddress = parseAddress(input.executorAddress, "executor");
  const ownerAddress = parseAddress(input.ownerAddress, "owner");
  const deployerAddress = parseAddress(input.deployerAddress, "deployer");
  if (!ATTRIBUTION_TAG_PATTERN.test(input.attributionTag)) {
    throw new Error("CELO_ATTRIBUTION_TAG must be the assigned celo_ plus 12 lowercase hex characters.");
  }
  const actors = [executorAddress, ownerAddress, deployerAddress].map((value) => value.toLowerCase());
  if (new Set(actors).size !== actors.length) {
    throw new Error("Factory deployer, executor, and owner addresses must be distinct.");
  }
  return Object.freeze({
    executorAddress,
    ownerAddress,
    deployerAddress,
    attributionTag: input.attributionTag,
  });
}

export async function buildTaggedFactoryDeploymentData(input: Readonly<{
  artifact: FactoryArtifact;
  executorAddress: string;
  attributionTag: string;
}>): Promise<Readonly<{ baseData: Hex; data: Hex; suffix: Hex }>> {
  const executorAddress = parseAddress(input.executorAddress, "executor");
  if (!ATTRIBUTION_TAG_PATTERN.test(input.attributionTag)) {
    throw new Error("Invalid Celo attribution tag.");
  }
  const bytecode = typeof input.artifact.bytecode === "string"
    ? input.artifact.bytecode
    : input.artifact.bytecode?.object;
  if (!isHexString(bytecode) || bytecode === "0x") {
    throw new Error("Factory artifact does not contain deployable bytecode.");
  }
  const factory = new ContractFactory(input.artifact.abi as never, bytecode);
  const transaction = await factory.getDeployTransaction(executorAddress);
  if (typeof transaction.data !== "string" || transaction.data === "0x") {
    throw new Error("Factory deployment data is unavailable.");
  }
  const baseData = transaction.data as Hex;
  const suffix = toDataSuffix(input.attributionTag);
  const data = concat([baseData, suffix]) as Hex;
  const decoded = fromDataSuffix(data);
  if (!decoded || decoded.schemaId !== 0 || !decoded.codes.includes(input.attributionTag)) {
    throw new Error("Factory deployment attribution suffix failed local verification.");
  }
  return Object.freeze({ baseData, data, suffix });
}

export async function assertRemoteCeloMainnetChain(provider: Readonly<{
  send(method: string, params: readonly unknown[]): Promise<unknown>;
}>): Promise<bigint> {
  const remoteChainId = await provider.send("eth_chainId", []);
  if (typeof remoteChainId !== "string" || !/^0x[0-9a-fA-F]+$/.test(remoteChainId)) {
    throw new Error("Celo RPC returned an invalid chain id.");
  }
  const chainId = BigInt(remoteChainId);
  if (chainId !== CELO_MAINNET_CHAIN_ID) {
    throw new Error(`Refusing factory deployment on remote chain ${chainId}; expected 42220.`);
  }
  return chainId;
}

export async function verifyFactoryTransactionAttribution(input: Readonly<{
  hash: string;
  attributionTag: string;
  getTransactionData(hash: Hex): Promise<string | null>;
}>) {
  if (!isHexString(input.hash, 32)) throw new Error("Factory transaction hash is invalid.");
  if (!ATTRIBUTION_TAG_PATTERN.test(input.attributionTag)) throw new Error("Invalid Celo attribution tag.");
  const attribution = await verifyTx({
    client: {
      async getTransaction({ hash }) {
        const data = await input.getTransactionData(hash);
        return data ? { input: data } : null;
      },
    },
    hash: input.hash as Hex,
  });
  if (!attribution || attribution.schemaId !== 0 || !attribution.codes.includes(input.attributionTag)) {
    throw new Error("Confirmed factory transaction is missing the registered Celo attribution tag.");
  }
  return Object.freeze({ codes: [...attribution.codes], schemaId: attribution.schemaId });
}

export async function deployCeloMainnetFactory(options: Readonly<{
  env?: NodeJS.ProcessEnv;
  artifactPath?: string;
  outputPath?: string;
  broadcast?: boolean;
}> = {}) {
  const env = options.env ?? process.env;
  const rpcUrl = requireHttpsUrl(env.CELO_MAINNET_RPC_URL, "CELO_MAINNET_RPC_URL");
  const privateKey = requirePrivateKey(env.SETUP_DEPLOYER_PRIVATE_KEY);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const input = validateFactoryDeploymentInput({
    executorAddress: requireText(env.AGENTPAY_EXECUTOR_ADDRESS, "AGENTPAY_EXECUTOR_ADDRESS"),
    ownerAddress: requireText(env.AGENTPAY_OWNER_ADDRESS, "AGENTPAY_OWNER_ADDRESS"),
    deployerAddress: wallet.address,
    attributionTag: requireText(env.CELO_ATTRIBUTION_TAG, "CELO_ATTRIBUTION_TAG"),
  });
  const artifact = JSON.parse(await readFile(resolve(options.artifactPath ?? DEFAULT_ARTIFACT_PATH), "utf8")) as FactoryArtifact;
  const tagged = await buildTaggedFactoryDeploymentData({
    artifact,
    executorAddress: input.executorAddress,
    attributionTag: input.attributionTag,
  });

  const remoteChainId = await assertRemoteCeloMainnetChain(provider);
  const [ownerCode, executorCode, deployerCode, balance, nonce] = await Promise.all([
    provider.getCode(input.ownerAddress),
    provider.getCode(input.executorAddress),
    provider.getCode(input.deployerAddress),
    provider.getBalance(input.deployerAddress),
    provider.getTransactionCount(input.deployerAddress, "pending"),
  ]);
  if ([ownerCode, executorCode, deployerCode].some((code) => code !== "0x")) {
    throw new Error("Owner, executor, and factory deployer must all be EOAs before deployment.");
  }

  const [baseRuntime, taggedRuntime, gasEstimate, feeData] = await Promise.all([
    provider.call({ from: input.deployerAddress, data: tagged.baseData }),
    provider.call({ from: input.deployerAddress, data: tagged.data }),
    provider.estimateGas({ from: input.deployerAddress, data: tagged.data }),
    provider.getFeeData(),
  ]);
  if (baseRuntime === "0x" || keccak256(baseRuntime) !== keccak256(taggedRuntime)) {
    throw new Error("ERC-8021 suffix changes the factory runtime; deployment aborted.");
  }
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas || feePerGas <= 0n) throw new Error("Celo fee data is unavailable.");
  const gasLimit = (gasEstimate * 120n + 99n) / 100n;
  const maximumNetworkCostWei = gasLimit * feePerGas;
  if (balance <= maximumNetworkCostWei) {
    throw new Error("Factory deployer CELO balance is below the bounded deployment cost.");
  }
  const predictedAddress = getCreateAddress({ from: input.deployerAddress, nonce });
  const simulation = Object.freeze({
    chainId: Number(remoteChainId),
    deployerAddress: input.deployerAddress,
    executorAddress: input.executorAddress,
    ownerAddress: input.ownerAddress,
    predictedAddress,
    nonce,
    gasEstimate: gasEstimate.toString(),
    gasLimit: gasLimit.toString(),
    maximumNetworkCostWei: maximumNetworkCostWei.toString(),
    runtimeCodeHash: keccak256(taggedRuntime),
    attributionCodes: fromDataSuffix(tagged.data)?.codes ?? [],
  });
  if (!options.broadcast) return Object.freeze({ mode: "simulation" as const, ...simulation });

  const transaction = await wallet.sendTransaction({ data: tagged.data, gasLimit });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
    throw new Error("Factory deployment transaction did not confirm successfully.");
  }
  const contractAddress = getAddress(receipt.contractAddress);
  if (contractAddress !== predictedAddress) {
    throw new Error("Confirmed factory address does not match the preflight prediction.");
  }
  const factory = new Contract(contractAddress, artifact.abi as never, provider);
  const [code, executor, usdc, policyVersion, chainId] = await Promise.all([
    provider.getCode(contractAddress),
    factory.executor() as Promise<string>,
    factory.USDC() as Promise<string>,
    factory.POLICY_VERSION() as Promise<string>,
    factory.CELO_CHAIN_ID() as Promise<bigint>,
  ]);
  if (
    code === "0x" ||
    getAddress(executor) !== input.executorAddress ||
    getAddress(usdc) !== CELO_MAINNET_USDC ||
    String(policyVersion).toLowerCase() !== POLICY_VERSION ||
    chainId !== CELO_MAINNET_CHAIN_ID
  ) {
    throw new Error("Confirmed factory identity does not match the pinned Celo production policy.");
  }
  const attribution = await verifyFactoryTransactionAttribution({
    hash: transaction.hash,
    attributionTag: input.attributionTag,
    async getTransactionData(hash) {
      const deployedTransaction = await provider.getTransaction(hash);
      return deployedTransaction?.data ?? null;
    },
  });

  const evidence: FactoryDeploymentEvidence = Object.freeze({
    address: contractAddress.toLowerCase(),
    deploymentTxHash: transaction.hash.toLowerCase(),
    deploymentBlock: receipt.blockNumber,
    runtimeCodeHash: keccak256(code).toLowerCase(),
    executor: input.executorAddress.toLowerCase(),
    usdc: CELO_MAINNET_USDC,
    policyVersion: POLICY_VERSION,
  });
  const outputPath = resolve(options.outputPath ?? DEFAULT_OUTPUT_PATH);
  await writeJsonAtomically(outputPath, evidence);
  return Object.freeze({
    mode: "broadcast" as const,
    ...simulation,
    transactionHash: transaction.hash,
    contractAddress,
    deploymentBlock: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    attributionCodes: attribution.codes,
    evidencePath: outputPath,
    evidence,
  });
}

function parseAddress(value: string, label: string): string {
  let address: string;
  try {
    address = getAddress(value);
  } catch {
    throw new Error(`Invalid ${label} address.`);
  }
  if (address === ZeroAddress) throw new Error(`${label} address must be non-zero.`);
  return address;
}

function requireText(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function requirePrivateKey(value: string | undefined): string {
  const normalized = requireText(value, "SETUP_DEPLOYER_PRIVATE_KEY");
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error("SETUP_DEPLOYER_PRIVATE_KEY is invalid.");
  return normalized;
}

function requireHttpsUrl(value: string | undefined, name: string): string {
  const normalized = requireText(value, name);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${name} must be a non-loopback HTTPS URL.`);
  }
  return url.toString();
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, path);
}

function parseCliArgs(args: readonly string[]) {
  const options: { broadcast?: boolean; outputPath?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--broadcast") options.broadcast = true;
    else if (argument === "--out") {
      const outputPath = args[index + 1];
      if (!outputPath || outputPath.startsWith("--")) throw new Error("--out requires a path.");
      options.outputPath = outputPath;
      index += 1;
    } else if (argument === "--help" || argument === "-h") options.broadcast = undefined;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function helpText(): string {
  return [
    "Simulate or broadcast the ERC-8021-tagged AgentPay Celo mainnet factory deployment.",
    "",
    "Usage:",
    "  npm run contracts:deploy:celo:simulate",
    "  npm run contracts:deploy:celo",
    "",
    "Broadcasting requires the explicit --broadcast flag.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      console.log(helpText());
    } else {
      const result = await deployCeloMainnetFactory(parseCliArgs(process.argv.slice(2)));
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Factory deployment failed.");
    process.exitCode = 1;
  }
}
