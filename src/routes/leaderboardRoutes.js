import { Router } from "express";
import {
  handleGetCreatorScoreLeaderboard,
  handleGetKultPointsLeaderboard,
  handleGetLeaderboard,
  handleSubmitScore,
} from "../controllers/leaderboardController.js";

export const leaderboardRouter = Router();

leaderboardRouter.get("/creators", handleGetCreatorScoreLeaderboard);
leaderboardRouter.get("/kult-points", handleGetKultPointsLeaderboard);
leaderboardRouter.get("/:gameId", handleGetLeaderboard);
leaderboardRouter.post("/:gameId/scores", handleSubmitScore);
