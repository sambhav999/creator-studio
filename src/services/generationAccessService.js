import { Address } from "@ton/core";
import { countCreatedGamePackagesByCreator } from "./databaseService.js";
import { verifyAndRecordGenerationPayment } from "./zeroGPaymentService.js";
import { verifyAndRecordTonGenerationPayment } from "./tonPaymentService.js";
import { normalizeTier } from "./zeroGService.js";
import { consumeGenerationStarsOrder, generationStarsPrice, starsPaymentAvailable, consumeEditStarsOrder, editStarsPrice } from "./telegramStarsService.js";

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
// Canonicalizes an identity for whitelist matching. A TON address has several
// valid string forms for the SAME wallet (bounceable EQ…, non-bounceable UQ…,
// raw 0:…), so we reduce any TON address to its raw form. Everything else
// (EVM 0x…, Privy user id, telegram alias) is compared lowercased.
function canonicalIdentity(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  try {
    return Address.parse(s).toRawString().toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function unlimitedWalletSet() {
  return new Set(
    String(process.env.UNLIMITED_WALLETS || "")
      .split(",")
      .map((entry) => canonicalIdentity(entry))
      .filter(Boolean)
  );
}

function hasUnlimitedAccess({ creatorId, creatorAliases, evmWalletAddress, tonWalletAddress }) {
  const allow = unlimitedWalletSet();
  if (allow.size === 0) return false;
  const rawIdentities = [
    creatorId,
    evmWalletAddress,
    tonWalletAddress,
    ...(Array.isArray(creatorAliases) ? creatorAliases : [])
  ].filter(Boolean);
  const identities = rawIdentities.map((value) => canonicalIdentity(value)).filter(Boolean);
  const matched = identities.some((value) => allow.has(value));
  // Diagnostic: on a MISS, log the exact identity strings the gate saw so the
  // right one can be added to UNLIMITED_WALLETS. Only logs when a whitelist is
  // configured, so it stays quiet in normal operation.
  if (!matched) {
    console.log("[unlimited-wallet] no match — whitelist one of these identities:", rawIdentities);
  }
  return matched;
}

// Auto-detects which payment methods a user can actually use, from their
// connected identity: a TON wallet → TON, an EVM wallet → 0G, a Telegram login
// → Stars. `chain` is the primary on-chain method (TON preferred, else 0G, else
// the global default) so older clients that read a single method keep working.
function buildGenerationMethods({ tier, evmWalletAddress, tonWalletAddress, telegramUserId }) {
  const ton = tonWalletAddress ? { method: "ton", currency: "TON", amount: paidGenerationPriceTON(tier) } : null;
  const zerog = evmWalletAddress ? { method: "0g", currency: "0G", amount: paidGenerationPrice0G(tier) } : null;
  const starsAmount = generationStarsPrice(tier);
  const stars = (telegramUserId && starsPaymentAvailable() && starsAmount > 0)
    ? { method: "stars", currency: "XTR", amount: starsAmount, available: true }
    : null;
  let chain = ton ?? zerog;
  if (!chain) {
    const d = paymentDetails(tier);
    chain = { method: d.currency === "0G" ? "0g" : "ton", currency: d.currency, amount: d.amount };
  }
  return { chain, ton, "0g": zerog, stars };
}

// 402 advertising exactly the methods this user can pay with.
function generationAccessError({ existingGames, tier, methods }) {
  const options = [methods.ton, methods["0g"], methods.stars]
    .filter(Boolean)
    .map((m) => `${m.amount} ${m.currency}`);
  if (options.length === 0) options.push(`${methods.chain.amount} ${methods.chain.currency}`);
  const error = new Error(`You already generated your free game. Generate another for ${options.join(" or ")}.`);
  error.status = 402;
  error.code = "PAID_GENERATION_REQUIRED";
  error.payment = {
    required: true,
    currency: methods.chain.currency,
    amount: methods.chain.amount,
    tier: normalizeTier(tier),
    existingGames,
    methods
  };
  return error;
}

export async function assertGenerationAccess({
  creatorId,
  creatorAliases,
  paymentTxHash,
  evmWalletAddress,
  tonWalletAddress,
  tier,
  paymentMethod,
  starsOrderId,
  auth
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

  // Methods this user can actually pay with, auto-detected from their identity.
  const methods = buildGenerationMethods({ tier, evmWalletAddress, tonWalletAddress, telegramUserId: auth?.telegramUserId });

  // Paid path — Stars: consume a prepaid Telegram order.
  if (paymentMethod === "stars" || (starsOrderId && paymentMethod !== "ton" && paymentMethod !== "0g")) {
    if (!starsOrderId) {
      throw generationAccessError({ existingGames, tier, methods });
    }
    const payment = await consumeGenerationStarsOrder({ auth, orderId: starsOrderId, tier });
    return {
      free: false,
      currency: "XTR",
      amount: payment.starsAmount,
      tier: paymentRequirement.tier,
      existingGames,
      paymentMethod: "stars",
      starsOrderId,
      payment
    };
  }

  // On-chain path. The verification currency is the method the client chose, or
  // — when unspecified — the user's primary chain method (TON wallet → TON,
  // EVM/0G wallet → 0G). This is the "auto currency by connection" behavior.
  const chosen = paymentMethod === "0g" ? "0g" : paymentMethod === "ton" ? "ton" : methods.chain.method;
  const chosenAmount = chosen === "0g" ? paidGenerationPrice0G(tier) : paidGenerationPriceTON(tier);
  if (!paymentTxHash) {
    throw generationAccessError({ existingGames, tier, methods });
  }
  const payment = chosen === "0g"
    ? await verifyAndRecordGenerationPayment({
        txHash: paymentTxHash,
        creatorId: evmWalletAddress ?? creatorId,
        amount0G: chosenAmount
      })
    : await verifyAndRecordTonGenerationPayment({
        reference: paymentTxHash,
        creatorId: tonWalletAddress ?? creatorId,
        amountTon: chosenAmount
      });
  return {
    free: false,
    currency: chosen === "0g" ? "0G" : "TON",
    amount: chosenAmount,
    tier: paymentRequirement.tier,
    existingGames,
    paymentMethod: chosen,
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
  tier,
  paymentMethod,
  starsOrderId,
  auth
}) {
  const requirement = editingPaymentDetails(tier);

  if (hasUnlimitedAccess({ creatorId, creatorAliases, evmWalletAddress, tonWalletAddress })) {
    return { free: true, editing: true, currency: requirement.currency, amount: 0, tier: requirement.tier, unlimited: true };
  }

  // Edit methods available to THIS user (auto-detected from their identity).
  const methods = buildEditMethods({ tier, evmWalletAddress, tonWalletAddress, telegramUserId: auth?.telegramUserId });

  // The user's primary chain edit price is the gate. 0 = editing is FREE for
  // that tier (the default). Set it > 0 to charge; Stars is then an alternative.
  if (!methods.chain.amount || methods.chain.amount <= 0) {
    return { free: true, editing: true, currency: methods.chain.currency, amount: 0, tier: requirement.tier };
  }

  // Paid edit — Stars path consumes a prepaid edit order.
  if (paymentMethod === "stars" || (starsOrderId && paymentMethod !== "ton" && paymentMethod !== "0g")) {
    if (!starsOrderId) {
      throw editAccessError({ tier, methods });
    }
    const payment = await consumeEditStarsOrder({ auth, orderId: starsOrderId, tier });
    return { free: false, editing: true, currency: "XTR", amount: payment.starsAmount, tier: requirement.tier, paymentMethod: "stars", starsOrderId, payment };
  }

  const chosen = paymentMethod === "0g" ? "0g" : paymentMethod === "ton" ? "ton" : methods.chain.method;
  const chosenAmount = chosen === "0g" ? editingPrice0G(tier) : editingPriceTON(tier);
  if (!paymentTxHash) {
    throw editAccessError({ tier, methods });
  }
  const payment = chosen === "0g"
    ? await verifyAndRecordGenerationPayment({ txHash: paymentTxHash, creatorId: evmWalletAddress ?? creatorId, amount0G: chosenAmount })
    : await verifyAndRecordTonGenerationPayment({ reference: paymentTxHash, creatorId: tonWalletAddress ?? creatorId, amountTon: chosenAmount });

  return { free: false, editing: true, currency: chosen === "0g" ? "0G" : "TON", amount: chosenAmount, tier: requirement.tier, paymentMethod: chosen, paymentTxHash, payment };
}

// Edit methods available to a user (parallels buildGenerationMethods).
function buildEditMethods({ tier, evmWalletAddress, tonWalletAddress, telegramUserId }) {
  const ton = tonWalletAddress ? { method: "ton", currency: "TON", amount: editingPriceTON(tier) } : null;
  const zerog = evmWalletAddress ? { method: "0g", currency: "0G", amount: editingPrice0G(tier) } : null;
  const starsAmt = editStarsPrice(tier);
  const stars = (telegramUserId && starsPaymentAvailable() && starsAmt > 0)
    ? { method: "stars", currency: "XTR", amount: starsAmt, available: true }
    : null;
  let chain = ton ?? zerog;
  if (!chain) {
    const d = editingPaymentDetails(tier);
    chain = { method: d.currency === "0G" ? "0g" : "ton", currency: d.currency, amount: d.amount };
  }
  return { chain, ton, "0g": zerog, stars };
}

// 402 for a paid edit, advertising exactly the methods this user can pay with.
function editAccessError({ tier, methods }) {
  const options = [methods.ton, methods["0g"], methods.stars].filter(Boolean).filter((m) => m.amount > 0).map((m) => `${m.amount} ${m.currency}`);
  const error = new Error(`This edit costs ${options.join(" or ")}.`);
  error.status = 402;
  error.code = "PAID_EDIT_REQUIRED";
  error.payment = {
    required: true,
    editing: true,
    currency: methods.chain.currency,
    amount: methods.chain.amount,
    tier: normalizeTier(tier),
    methods
  };
  return error;
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
    priceStars: generationAccess.currency === "XTR" && !generationAccess.free ? generationAccess.amount : 0,
    paymentMethod: generationAccess.paymentMethod ?? null,
    starsOrderId: generationAccess.starsOrderId ?? null,
    paymentTxHash: generationAccess.paymentTxHash ?? null,
    payment: generationAccess.payment ?? null,
    existingGamesBeforeCreate: generationAccess.existingGames
  };
}
