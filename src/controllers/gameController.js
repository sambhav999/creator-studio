import { z } from "zod";
import { createGamePackage } from "../services/gameFactoryService.js";
import { createRefinementBundle } from "../services/refinementService.js";

const createSchema = z.object({
  templateId: z.string().min(1),
  prompt: z.string().optional(),
  theme: z.string().optional(),
  difficulty: z.enum(["easy", "normal", "hard", "insane"]).optional(),
  customization: z.enum(["light", "medium", "heavy"]).optional(),
  extra: z.enum(["none", "powerups", "leaderboard", "boss"]).optional()
});

const refineSchema = z.object({
  gamePackage: z.record(z.any()),
  request: z.string().optional(),
  refinementLevel: z.string().optional()
});

export function createGame(request, response, next) {
  try {
    const input = createSchema.parse(request.body);
    const game = createGamePackage(input);
    response.status(201).json({ game });
  } catch (error) {
    next(error);
  }
}

export function refineGame(request, response, next) {
  try {
    const input = refineSchema.parse(request.body);
    const refinement = createRefinementBundle(input);
    response.status(202).json({ refinement });
  } catch (error) {
    next(error);
  }
}
