import { countCreatedGamePackagesByCreator } from "./databaseService.js";
import { verifyAndRecordGenerationPayment } from "./zeroGPaymentService.js";
import { verifyAndRecordTonGenerationPayment } from "./tonPaymentService.js";

export function paidGenerationPrice0G() {
  const value = Number(process.env.PAID_GAME_PRICE_0G);
  return Number.isFinite(value) && value >= 0 ? value : 2;
}

export function paidGenerationPriceTON() {
  const value = Number(process.env.PAID_GAME_PRICE_TON);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function paidGenerationCurrency() {
  return String(process.env.PAID_GAME_CURRENCY || "TON").trim().toUpperCase() === "0G" ? "0G" : "TON";
}

function paymentDetails() {
  const currency = paidGenerationCurrency();
  if (currency === "0G") {
    return { currency, amount: paidGenerationPrice0G() };
  }
  return { currency, amount: paidGenerationPriceTON() };
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
  tonWalletAddress
}) {
  const ownerIds = Array.isArray(creatorAliases) && creatorAliases.length > 0 ? creatorAliases : creatorId;
  const existingGames = await countCreatedGamePackagesByCreator(ownerIds);
  const paymentRequirement = paymentDetails();
  if (existingGames < 1) {
    return {
      free: true,
      currency: paymentRequirement.currency,
      amount: paymentRequirement.amount,
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
    existingGames,
    paymentTxHash,
    payment
  };
}

export function generationAccessMetadata(generationAccess) {
  return {
    free: generationAccess.free,
    currency: generationAccess.currency ?? "TON",
    amount: generationAccess.free ? 0 : generationAccess.amount,
    price0G: generationAccess.currency === "0G" && !generationAccess.free ? generationAccess.amount : 0,
    priceTON: generationAccess.currency === "TON" && !generationAccess.free ? generationAccess.amount : 0,
    paymentTxHash: generationAccess.paymentTxHash ?? null,
    payment: generationAccess.payment ?? null,
    existingGamesBeforeCreate: generationAccess.existingGames
  };
}
