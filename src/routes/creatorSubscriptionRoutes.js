import { Router } from "express";
import {
  confirmMyCreatorSubscription,
  listCreatorSubscriptionTiers,
  quoteMyCreatorSubscription,
  showMyCreatorSubscription
} from "../controllers/creatorSubscriptionController.js";
import { requireAuth } from "../services/authService.js";

export const creatorSubscriptionRouter = Router();

creatorSubscriptionRouter.get("/tiers", listCreatorSubscriptionTiers);
creatorSubscriptionRouter.get("/me", requireAuth, showMyCreatorSubscription);
creatorSubscriptionRouter.post("/quote", requireAuth, quoteMyCreatorSubscription);
creatorSubscriptionRouter.post("/confirm", requireAuth, confirmMyCreatorSubscription);
