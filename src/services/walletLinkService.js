import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";

const CHAIN_ID = Number(process.env.ZEROG_CHAIN_ID_MAINNET || 16661);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { privyUserId: string, address: string, expiresAt: number }>} */
const challenges = new Map();

function normalizeEvmAddress(value, field = "Wallet") {
  try {
    return getAddress(String(value || "").trim());
  } catch {
    const error = new Error(`${field} must be a valid EVM address`);
    error.status = 400;
    error.code = "EVM_WALLET_REQUIRED";
    throw error;
  }
}

function purgeExpiredChallenges() {
  const now = Date.now();
  for (const [nonce, entry] of challenges.entries()) {
    if (entry.expiresAt <= now) challenges.delete(nonce);
  }
}

export function getZeroGWalletLinkChainId() {
  return CHAIN_ID;
}

export function createWalletLinkChallenge({ privyUserId, address }) {
  purgeExpiredChallenges();
  if (!privyUserId) {
    const error = new Error("Sign in before linking a wallet");
    error.status = 401;
    throw error;
  }

  const normalizedAddress = normalizeEvmAddress(address);
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = [
    "KULT Creator Studio — link this wallet to your account.",
    `Address: ${normalizedAddress}`,
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join("\n");

  challenges.set(nonce, {
    privyUserId: String(privyUserId),
    address: normalizedAddress,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });

  return {
    message,
    nonce,
    chainId: CHAIN_ID,
    address: normalizedAddress,
    expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}

function extractNonce(message) {
  const match = String(message || "").match(/^Nonce: ([a-f0-9]+)$/m);
  return match?.[1] ?? null;
}

export function verifyWalletLinkSignature({ message, signature, address, privyUserId }) {
  purgeExpiredChallenges();
  const normalizedAddress = normalizeEvmAddress(address);
  const nonce = extractNonce(message);
  if (!nonce) {
    const error = new Error("Wallet link message is invalid or missing a nonce");
    error.status = 400;
    throw error;
  }

  const challenge = challenges.get(nonce);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    const error = new Error("Wallet link challenge expired. Request a new signature.");
    error.status = 400;
    error.code = "WALLET_LINK_EXPIRED";
    throw error;
  }

  if (challenge.address !== normalizedAddress) {
    const error = new Error("Wallet link message does not match the selected address");
    error.status = 400;
    throw error;
  }

  if (challenge.privyUserId !== String(privyUserId || "")) {
    const error = new Error("Wallet link challenge belongs to a different signed-in user");
    error.status = 403;
    throw error;
  }

  let recovered;
  try {
    recovered = getAddress(verifyMessage(message, signature));
  } catch {
    const error = new Error("Could not verify wallet signature");
    error.status = 400;
    throw error;
  }

  if (recovered !== normalizedAddress) {
    const error = new Error("Wallet signature does not match the linked address");
    error.status = 400;
    throw error;
  }

  challenges.delete(nonce);
  return normalizedAddress;
}
