import { ethers } from "ethers";
import { getDatabase } from "./databaseService.js";

const COLLECTION_NAME = process.env.ZERO_G_ACTIVITY_COLLECTION || "zero_g_onchain_activities";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ACTIVITY_REGISTRY_ABI = [
  "event ActivityRecorded(uint256 indexed activityId,address indexed actor,bytes32 indexed activityType,string entityId,string metadataURI,bytes32 metadataHash,uint256 timestamp)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function recordActivity(address actor,bytes32 activityType,string entityId,string metadataURI,bytes32 metadataHash) returns (uint256)"
];

const ACTIVITY_TYPE_ALIASES = new Map([
  ["create", "game-created"],
  ["publish", "game-published"],
  ["unpublish", "game-unpublished"],
  ["major_edit", "game-edited"],
  ["tournament_result", "tournament-result"],
  ["reward_claim", "reward-claim"]
]);

let indexesReady;
let transactionChain = Promise.resolve();

function env(name) {
  return process.env[name]?.trim();
}

function privateKey() {
  return env("ZERO_G_ACTIVITY_PRIVATE_KEY")
    || env("CONTRACT_DEPLOYER_PRIVATE_KEY")
    || env("CONTRACT_DEPLOYER_ADDRESS")
    || "";
}

function activityRpcUrl() {
  return env("ZERO_G_ACTIVITY_RPC_URL")
    || env("ZERO_G_MAINNET_RPC_URL")
    || env("ZERO_G_PAYMENT_RPC_URL")
    || env("WEB3_PROVIDER_URL")
    || "https://evmrpc.0g.ai";
}

function expectedChainId() {
  const value = Number(env("ZERO_G_ACTIVITY_CHAIN_ID") || env("ZERO_G_MAINNET_CHAIN_ID") || 16661);
  return Number.isFinite(value) && value > 0 ? BigInt(value) : 16661n;
}

function contractAddress() {
  return env("ZERO_G_ACTIVITY_CONTRACT_ADDRESS") || env("CONTRACT_ADDRESS") || "";
}

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) return "";
  return key.startsWith("0x") ? key : `0x${key}`;
}

function normalizeActorAddress(address, fallback) {
  try {
    return ethers.getAddress(String(address || ""));
  } catch {
    return fallback;
  }
}

function normalizeEntityId(entityId) {
  return String(entityId ?? "").trim().slice(0, 160);
}

function normalizeActivityType(activityType) {
  const normalized = String(activityType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ACTIVITY_TYPE_ALIASES.get(normalized) || normalized || "activity";
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])])
    );
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function metadataDigest(metadata) {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(stableJson(metadata ?? {}))));
}

function activityTypeBytes(activityType) {
  return ethers.id(activityType);
}

async function collection() {
  const database = await getDatabase();
  const col = database.collection(COLLECTION_NAME);
  if (!indexesReady) {
    indexesReady = Promise.all([
      col.createIndex({ status: 1, createdAt: -1 }),
      col.createIndex({ activityType: 1, entityId: 1, createdAt: -1 }),
      col.createIndex({ txHash: 1 }),
      col.createIndex({ onchainActivityId: 1 }),
      col.createIndex({ "metadata.userId": 1, createdAt: -1 }),
      col.createIndex({ "metadata.gameId": 1, createdAt: -1 })
    ]).catch((error) => {
      indexesReady = undefined;
      throw error;
    });
  }
  await indexesReady;
  return col;
}

export function getZeroGActivityContractConfig() {
  const key = normalizePrivateKey(privateKey());
  return {
    enabled: env("ZERO_G_ACTIVITY_ENABLED") !== "false",
    configured: Boolean(contractAddress() && key),
    rpcUrl: activityRpcUrl(),
    chainId: Number(expectedChainId()),
    contractAddress: contractAddress() || null,
    hasPrivateKey: Boolean(key),
    collection: COLLECTION_NAME
  };
}

export function isZeroGActivityContractConfigured() {
  const config = getZeroGActivityContractConfig();
  return config.enabled && config.configured;
}

async function signerAndContract() {
  const key = normalizePrivateKey(privateKey());
  if (!key) throw new Error("ZERO_G_ACTIVITY_PRIVATE_KEY is required for on-chain activity recording");
  const address = contractAddress();
  if (!ethers.isAddress(address)) throw new Error("ZERO_G_ACTIVITY_CONTRACT_ADDRESS must be a valid EVM address");

  const provider = new ethers.JsonRpcProvider(activityRpcUrl(), Number(expectedChainId()));
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId()) {
    throw new Error(`Connected RPC is not 0G chain ${Number(expectedChainId())}`);
  }
  const signer = new ethers.Wallet(key, provider);
  return {
    signer,
    contract: new ethers.Contract(address, ACTIVITY_REGISTRY_ABI, signer)
  };
}

function parseActivityId(receipt, contract) {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "ActivityRecorded") {
        return parsed.args.activityId?.toString() ?? null;
      }
    } catch {
      // Ignore logs from other contracts in the same receipt.
    }
  }
  return null;
}

async function writeOnchainActivity(input) {
  const now = new Date();
  const activityType = normalizeActivityType(input.activityType);
  const entityId = normalizeEntityId(input.entityId);
  const metadata = stableJson({
    ...(input.metadata ?? {}),
    activityType,
    entityId,
    metadataURI: input.metadataURI ?? input.storage?.uri ?? null,
    zeroGStorage: input.storage ?? null,
    recordedAt: now.toISOString()
  });
  const metadataHash = input.metadataHash || metadataDigest(metadata);
  const metadataURI = String(input.metadataURI ?? input.storage?.uri ?? "");
  const col = await collection();

  const baseRecord = {
    activityType,
    activityTypeHash: activityTypeBytes(activityType),
    entityId,
    metadataURI,
    metadataHash,
    metadata,
    provider: "0g-chain",
    contractAddress: contractAddress() || null,
    chainId: Number(expectedChainId()),
    createdAt: now,
    updatedAt: now
  };

  if (!isZeroGActivityContractConfigured()) {
    const reason = getZeroGActivityContractConfig().enabled
      ? "Missing ZERO_G_ACTIVITY_CONTRACT_ADDRESS or ZERO_G_ACTIVITY_PRIVATE_KEY"
      : "ZERO_G_ACTIVITY_ENABLED=false";
    await col.insertOne({ ...baseRecord, actor: ZERO_ADDRESS, status: "skipped", reason });
    return { status: "skipped", reason };
  }

  const pending = await col.insertOne({ ...baseRecord, actor: ZERO_ADDRESS, status: "pending" });
  const id = pending.insertedId;

  try {
    const { signer, contract } = await signerAndContract();
    const actor = normalizeActorAddress(input.actorAddress, signer.address);
    await col.updateOne({ _id: id }, { $set: { actor, updatedAt: new Date() } });

    const tx = await contract.recordActivity(
      actor,
      activityTypeBytes(activityType),
      entityId,
      metadataURI,
      metadataHash
    );
    await col.updateOne(
      { _id: id },
      { $set: { status: "submitted", txHash: tx.hash, updatedAt: new Date() } }
    );

    const confirmations = Number(env("ZERO_G_ACTIVITY_CONFIRMATIONS") || 1);
    const receipt = await tx.wait(Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 1);
    const onchainActivityId = parseActivityId(receipt, contract);
    const result = {
      status: receipt.status === 1 ? "confirmed" : "failed",
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      onchainActivityId,
      actor,
      contractAddress: await contract.getAddress(),
      chainId: Number(expectedChainId()),
      updatedAt: new Date()
    };
    await col.updateOne({ _id: id }, { $set: result });
    return result;
  } catch (error) {
    await col.updateOne(
      { _id: id },
      {
        $set: {
          status: "failed",
          error: { message: error.message, code: error.code ?? null },
          updatedAt: new Date()
        }
      }
    );
    throw error;
  }
}

export function recordOnchainActivity(input) {
  const run = transactionChain.then(
    () => writeOnchainActivity(input),
    () => writeOnchainActivity(input)
  );
  transactionChain = run.then(() => undefined, () => undefined);
  return run;
}

export function recordOnchainActivityQuietly(input) {
  void recordOnchainActivity(input).catch((error) => {
    console.warn("0G on-chain activity record failed", {
      activityType: input?.activityType,
      entityId: input?.entityId,
      message: error.message
    });
  });
}
