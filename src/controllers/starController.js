import { z } from "zod";
import {
  createLaunchBoostOrder,
  createGenerationStarsOrder,
  createEditStarsOrder,
  getStarOrder,
  handleTelegramPaymentUpdate,
  launchBoostConfig
} from "../services/telegramStarsService.js";

const createOrderSchema = z.discriminatedUnion("productCode", [
  z.object({
    productCode: z.literal("launch_boost"),
    gameId: z.string().min(1)
  }).strict(),
  z.object({
    productCode: z.literal("game_generation"),
    tier: z.coerce.number().int().min(1).max(3)
  }).strict(),
  z.object({
    productCode: z.literal("game_edit"),
    tier: z.coerce.number().int().min(1).max(3)
  }).strict()
]);

const orderParamsSchema = z.object({
  orderId: z.string().min(1)
}).strict();

export async function handleGetStarsProducts(_request, response, next) {
  try {
    response.json({ products: [launchBoostConfig()] });
  } catch (error) {
    next(error);
  }
}

export async function handleCreateStarsOrder(request, response, next) {
  try {
    const input = createOrderSchema.parse(request.body ?? {});
    let order;
    if (input.productCode === "game_generation") {
      order = await createGenerationStarsOrder({ auth: request.auth, tier: input.tier });
    } else if (input.productCode === "game_edit") {
      order = await createEditStarsOrder({ auth: request.auth, tier: input.tier });
    } else {
      order = await createLaunchBoostOrder({ auth: request.auth, gameId: input.gameId });
    }
    response.status(201).json({ order });
  } catch (error) {
    next(error);
  }
}

export async function handleGetStarsOrder(request, response, next) {
  try {
    const { orderId } = orderParamsSchema.parse(request.params);
    const order = await getStarOrder({ auth: request.auth, orderId });
    if (!order) {
      response.status(404).json({ error: "Stars order not found" });
      return;
    }
    response.json({ order });
  } catch (error) {
    next(error);
  }
}

export async function handleTelegramWebhook(request, response, next) {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const actualSecret = request.get("x-telegram-bot-api-secret-token");
    if (expectedSecret && actualSecret !== expectedSecret) {
      response.status(401).json({ error: "Invalid Telegram webhook secret" });
      return;
    }
    const result = await handleTelegramPaymentUpdate(request.body ?? {});
    response.json(result);
  } catch (error) {
    next(error);
  }
}
