import { countCreatedGamePackagesByCreator } from "./databaseService.js";
import { verifyAndRecordGenerationPayment } from "./zeroGPaymentService.js";
import { verifyAndRecordTonGenerationPayment } from "./tonPaymentService.js";
import { normalizeTier } from "./zeroGService.js";

// Reads a non-negative number from env, else the given fallback.
function envPrice(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Built-in per-tier defaults, used only when the matching env var is unset.
// Tier 1 is the cheap/entry tier; Tier 3 is premium.
const DEFAULT_TON_PRICE = { 1: 1, 2: 3, 3: 8 };
const DEFAULT_0G_PRICE = { 1: 2, 2: 6, 3: 15 };

// Price per generation in 0G. With a tier, prefers PAID_GAME_PRICE_0G_TIER{n},
// then the global PAID_GAME_PRICE_0G, then the built-in tier default.
export function paidGenerationPrice0G(tier) {
  const n = normalizeTier(tier);
  const globalDefault = envPrice("PAID_GAME_PRICE_0G", n ? DEFAULT_0G_PRICE[n] : 2);
  if (!n) return globalDefault;
  return envPrice(`PAID_GAME_PRICE_0G_TIER${n}`, globalDefault);
}

// Price per generation in TON. Same precedence as above.
export function paidGenerationPriceTON(tier) {
  const n = normalizeTier(tier);
  const globalDefault = envPrice("PAID_GAME_PRICE_TON", n ? DEFAULT_TON_PRICE[n] : 1);
  if (!n) return globalDefault;
  return envPrice(`PAID_GAME_PRICE_TON_TIER${n}`, globalDefault);
}

// Built-in per-tier EDITING price defaults (post-creation "wish" edits). 0 =
// free. Editing is free by default; set EDIT_PRICE_* in .env to charge per edit.
const DEFAULT_EDIT_TON_PRICE = { 1: 0, 2: 0, 3: 0 };
const DEFAULT_EDIT_0G_PRICE = { 1: 0, 2: 0, 3: 0 };

// Editing price in 0G for a tier. EDIT_PRICE_0G_TIER{n} → built-in default (0).
export function editingPrice0G(tier) {
  const n = normalizeTier(tier) ?? 1;
  return envPrice(`EDIT_PRICE_0G_TIER${n}`, DEFAULT_EDIT_0G_PRICE[n]);
}

// Editing price in TON for a tier. EDIT_PRICE_TON_TIER{n} → built-in default (0).
export function editingPriceTON(tier) {
  const n = normalizeTier(tier) ?? 1;
  return envPrice(`EDIT_PRICE_TON_TIER${n}`, DEFAULT_EDIT_TON_PRICE[n]);
}

function paidGenerationCurrency() {
  return String(process.env.PAID_GAME_CURRENCY || "TON").trim().toUpperCase() === "0G" ? "0G" : "TON";
}

function editingPaymentDetails(tier) {
  const currency = paidGenerationCurrency();
  const amount = currency === "0G" ? editingPrice0G(tier) : editingPriceTON(tier);
  return { currency, amount, tier: normalizeTier(tier) };
}

function paymentDetails(tier) {
  const currency = paidGenerationCurrency();
  if (currency === "0G") {
    return { currency, amount: paidGenerationPrice0G(tier), tier: normalizeTier(tier) };
  }
  return { currency, amount: paidGenerationPriceTON(tier), tier: normalizeTier(tier) };
}

// Wallets/identities in UNLIMITED_WALLETS (comma-separated in .env) skip the
// payment gate entirely: unlimited games on any tier, always free. Matching is
// case-insensitive and only checks the AUTHENTICATED identity/wallets on the
// request, so it can't be spoofed by typing an address — the caller must control
// the wallet to be authed as it.
function unlimitedWalletSet() {
  return new Set(
    String(process.env.UNLIMITED_WALLETS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasUnlimitedAccess({ creatorId, creatorAliases, evmWalletAddress, tonWalletAddress }) {
  const allow = unlimitedWalletSet();
  if (allow.size === 0) return false;
  const identities = [
    creatorId,
    evmWalletAddress,
    tonWalletAddress,
    ...(Array.isArray(creatorAliases) ? creatorAliases : [])
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return identities.some((value) => allow.has(value));
}

function generationAccessError({ amount, currency, existingGames }) {
  const error = new Error(`You already generated your free game. Generate another game for ${amount} ${currency}.`);
  error.status = 402;
  error.code = "PAID_GENERATION_REQUIRED";
  error.payment = {
    required: true,
    currency,
    amount,
    existingGames
  };
  return error;
}

export async function assertGenerationAccess({
  creatorId,
  creatorAliases,
  paymentTxHash,
  evmWalletAddress,
  tonWalletAddress,
  tier
}) {
  const paymentRequirement = paymentDetails(tier);

  // Whitelisted wallets bypass counting AND payment: unlimited free games, any tier.
  if (hasUnlimitedAccess({ creatorId, creatorAliases, evmWalletAddress, tonWalletAddress })) {
    return {
      free: true,
      currency: paymentRequirement.currency,
      amount: 0,
      tier: paymentRequirement.tier,
      existingGames: 0,
      unlimited: true
    };
  }

  const ownerIds = Array.isArray(creatorAliases) && creatorAliases.length > 0 ? creatorAliases : creatorId;
  const existingGames = await countCreatedGamePackagesByCreator(ownerIds);
  if (existingGames < 1) {
    return {
      free: true,
      currency: paymentRequirement.currency,
      amount: paymentRequirement.amount,
      tier: paymentRequirement.tier,
      existingGames
    };
  }
  if (!paymentTxHash) {
    throw generationAccessError({ ...paymentRequirement, existingGames });
  }
  const payment = paymentRequirement.currency === "0G"
    ? await verifyAndRecordGenerationPayment({
        txHash: paymentTxHash,
        creatorId: evmWalletAddress ?? creatorId,
        amount0G: paymentRequirement.amount
      })
    : await verifyAndRecordTonGenerationPayment({
        reference: paymentTxHash,
        creatorId: tonWalletAddress ?? creatorId,
        amountTon: paymentRequirement.amount
      });
  return {
    free: false,
    currency: paymentRequirement.currency,
    amount: paymentRequirement.amount,
    tier: paymentRequirement.tier,
    existingGames,
    paymentTxHash,
    payment
  };
}

// Access gate for post-creation EDITS. Independent of generation pricing: uses
// the EDIT_PRICE_* env vars per tier. When the tier's editing price is 0 (the
// default) editing is free; set a price to charge per edit. Whitelisted wallets
// always edit free. There is no "first edit free" rule — the price applies from
// the first paid edit.
export async function assertEditAccess({
  creatorId,
  creatorAliases,
  paymentTxHash,
  evmWalletAddress,
  tonWalletAddress,
  tier
}) {
  const requirement = editingPaymentDetails(tier);

  if (hasUnlimitedAccess({ creatorId, creatorAliases, evmWalletAddress, tonWalletAddress })) {
    return { free: true, editing: true, currency: requirement.currency, amount: 0, tier: requirement.tier, unlimited: true };
  }

  // Free editing (price 0) — the default.
  if (!requirement.amount || requirement.amount <= 0) {
    return { free: true, editing: true, currency: requirement.currency, amount: 0, tier: requirement.tier };
  }

  if (!paymentTxHash) {
    const error = new Error(`Editing on this tier costs ${requirement.amount} ${requirement.currency}.`);
    error.status = 402;
    error.code = "PAID_EDIT_REQUIRED";
    error.payment = { required: true, currency: requirement.currency, amount: requirement.amount, editing: true };
    throw error;
  }

  const payment = requirement.currency === "0G"
    ? await verifyAndRecordGenerationPayment({ txHash: paymentTxHash, creatorId: evmWalletAddress ?? creatorId, amount0G: requirement.amount })
    : await verifyAndRecordTonGenerationPayment({ reference: paymentTxHash, creatorId: tonWalletAddress ?? creatorId, amountTon: requirement.amount });

  return { free: false, editing: true, currency: requirement.currency, amount: requirement.amount, tier: requirement.tier, paymentTxHash, payment };
}

export function generationAccessMetadata(generationAccess) {
  return {
    free: generationAccess.free,
    unlimited: generationAccess.unlimited ?? false,
    currency: generationAccess.currency ?? "TON",
    tier: generationAccess.tier ?? null,
    amount: generationAccess.free ? 0 : generationAccess.amount,
    price0G: generationAccess.currency === "0G" && !generationAccess.free ? generationAccess.amount : 0,
    priceTON: generationAccess.currency === "TON" && !generationAccess.free ? generationAccess.amount : 0,
    paymentTxHash: generationAccess.paymentTxHash ?? null,
    payment: generationAccess.payment ?? null,
    existingGamesBeforeCreate: generationAccess.existingGames
  };
}
