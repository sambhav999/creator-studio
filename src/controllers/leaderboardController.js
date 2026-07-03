import { z } from "zod";
import { getLeaderboard, submitScore } from "../services/leaderboardService.js";
import { logActivity, getGameTitle } from "../services/activityService.js";

const gameParamsSchema = z.object({
  gameId: z.string().min(1),
}).strict();

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(500),
}).strict();

const scoreSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1).max(50),
  score: z.coerce.number().finite().nonnegative(),
}).strict();

export async function handleGetLeaderboard(request, response, next) {
  try {
    const { gameId } = gameParamsSchema.parse(request.params);
    const { limit } = leaderboardQuerySchema.parse(request.query);
    const leaderboard = await getLeaderboard(gameId, limit);
    response.json(leaderboard);
  } catch (error) {
    next(error);
  }
}

export async function handleSubmitScore(request, response, next) {
  try {
    const { gameId } = gameParamsSchema.parse(request.params);
    const input = scoreSchema.parse(request.body);
    const leaderboard = await submitScore({ gameId, ...input });

    // Log play activity
    const gameTitle = await getGameTitle(gameId);
    await logActivity({
      userId: input.userId,
      gameId,
      gameTitle,
      activityType: "play",
      details: `Scored ${input.score} points on ${gameTitle || "game"}`
    });

    response.status(201).json(leaderboard);
  } catch (error) {
    next(error);
  }
}
