import { z } from "zod";
import {
  createLaunchBoostOrder,
  getStarOrder,
  handleTelegramPaymentUpdate,
  launchBoostConfig
} from "../services/telegramStarsService.js";

const createOrderSchema = z.object({
  gameId: z.string().min(1),
  productCode: z.literal("launch_boost").default("launch_boost")
}).strict();

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
    const order = await createLaunchBoostOrder({
      auth: request.auth,
      gameId: input.gameId
    });
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
