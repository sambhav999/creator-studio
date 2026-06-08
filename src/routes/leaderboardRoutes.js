import { Router } from "express";
import {
  handleGetLeaderboard,
  handleSubmitScore,
} from "../controllers/leaderboardController.js";

export const leaderboardRouter = Router();

leaderboardRouter.get("/:gameId", handleGetLeaderboard);
leaderboardRouter.post("/:gameId/scores", handleSubmitScore);
