import { Router } from "express";
import {
  handleCreateStarsOrder,
  handleGetStarsOrder,
  handleGetStarsProducts,
  handleTelegramWebhook
} from "../controllers/starController.js";
import { requireAuth } from "../services/authService.js";

export const starRouter = Router();
export const telegramRouter = Router();

starRouter.get("/products", handleGetStarsProducts);
starRouter.post("/orders", requireAuth, handleCreateStarsOrder);
starRouter.get("/orders/:orderId", requireAuth, handleGetStarsOrder);

telegramRouter.post("/webhook", handleTelegramWebhook);
