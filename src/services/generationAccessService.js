import { countCreatedGamePackagesByCreator } from "./databaseService.js";
import { verifyAndRecordGenerationPayment } from "./zeroGPaymentService.js";

export function paidGenerationPrice0G() {
  const value = Number(process.env.PAID_GAME_PRICE_0G);
  return Number.isFinite(value) && value >= 0 ? value : 2;
}

function generationAccessError({ price0G, existingGames }) {
  const error = new Error(`You already generated your free game. Generate another game for ${price0G} 0G.`);
  error.status = 402;
  error.code = "PAID_GENERATION_REQUIRED";
  error.payment = {
    required: true,
    currency: "0G",
    amount: price0G,
    existingGames
  };
  return error;
}

export async function assertGenerationAccess({ creatorId, paymentTxHash }) {
  const existingGames = await countCreatedGamePackagesByCreator(creatorId);
  const price0G = paidGenerationPrice0G();
  if (existingGames < 1) {
    return {
      free: true,
      price0G,
      existingGames
    };
  }
  if (!paymentTxHash) {
    throw generationAccessError({ price0G, existingGames });
  }
  const payment = await verifyAndRecordGenerationPayment({
    txHash: paymentTxHash,
    creatorId,
    amount0G: price0G
  });
  return {
    free: false,
    price0G,
    existingGames,
    paymentTxHash,
    payment
  };
}

export function generationAccessMetadata(generationAccess) {
  return {
    free: generationAccess.free,
    price0G: generationAccess.free ? 0 : generationAccess.price0G,
    paymentTxHash: generationAccess.paymentTxHash ?? null,
    payment: generationAccess.payment ?? null,
    existingGamesBeforeCreate: generationAccess.existingGames
  };
}
