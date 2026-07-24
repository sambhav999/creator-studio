import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

// On-chain activity logging: every real product action sends one 0G transaction
// to the KultActivityLog contract, producing a discoverable on-chain footprint
// (readable via the contract's `totalActivities` counter and Activity events).
// FIRE-AND-FORGET: logging must never block or break the product flow.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "contracts", "KultActivityLog.abi.json"), "utf8")
);

// Canonical action names — one per real product action.
export const ACTIVITY = {
  LOGIN: "login",
  GAME_GENERATED: "game_generated",
  GAME_EDITED: "game_edited",
  GAME_PUBLISHED: "game_published",
  PLAY_STARTED: "play_started",
  PLAY_QUALIFIED: "play_qualified",
  GAME_COMPLETED: "game_completed",
  SCORE_SUBMITTED: "score_submitted",
  LIKE: "like",
  SHARE: "share",
  FOLLOW: "follow",
  REFERRAL: "referral_attributed",
  POINTS_AWARDED: "points_awarded",
  PAYMENT: "payment",
  ASSET_STORED: "asset_stored"
};

function config() {
  return {
    enabled: process.env.ZERO_G_ACTIVITY_ENABLED !== "false",
    contract: process.env.ZERO_G_ACTIVITY_CONTRACT?.trim(),
    rpc: process.env.ZERO_G_STORAGE_EVM_RPC || process.env.ZERO_G_PAYMENT_RPC_URL || "https://evmrpc.0g.ai",
    privateKey: process.env.ZERO_G_STORAGE_PRIVATE_KEY || process.env.ZERO_G_PRIVATE_KEY
  };
}

export function isActivityLogConfigured() {
  const c = config();
  return Boolean(c.enabled && c.contract && c.privateKey);
}

let cached = null;
function getContract() {
  const c = config();
  if (!isActivityLogConfigured()) return null;
  if (cached && cached.contractAddr === c.contract && cached.rpc === c.rpc) return cached.contract;
  const provider = new ethers.JsonRpcProvider(c.rpc);
  const wallet = new ethers.Wallet(c.privateKey, provider);
  const contract = new ethers.Contract(c.contract, ABI, wallet);
  cached = { contract, contractAddr: c.contract, rpc: c.rpc };
  return contract;
}

// All log txs sign from the SAME wallet, so concurrent sends collide on the
// nonce ("replacement fee too low"). Serialize through one promise chain.
let chain = Promise.resolve();

async function sendLog(action, refId) {
  const contract = getContract();
  if (!contract) return;
  const tx = await contract.log(action, String(refId ?? ""));
  return tx.hash;
}

/**
 * Fire-and-forget: records one on-chain activity event. Never throws to callers.
 * @param {string} action one of ACTIVITY.*
 * @param {string|number} refId a reference (gameId, userId, txHash, eventId…)
 */
export function logActivityOnChain(action, refId = "") {
  if (!action || !isActivityLogConfigured()) return;
  chain = chain.then(
    () => sendLog(action, refId).catch((error) => {
      console.warn("0G activity log failed", { action, message: error.message });
    }),
    () => sendLog(action, refId).catch(() => undefined)
  );
}

// Reads the on-chain total (handy for a grant dashboard / health check).
export async function getOnChainActivityTotal() {
  const contract = getContract();
  if (!contract) return null;
  const total = await contract.totalActivities();
  return Number(total);
}
