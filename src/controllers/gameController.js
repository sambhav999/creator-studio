import { z } from "zod";
import { buildGameCodeZip } from "../services/codeExportService.js";
import { saveGamePackage } from "../services/databaseService.js";
import { createGamePackage } from "../services/gameFactoryService.js";
import { generateGameFromPrompt } from "../services/promptPipelineService.js";
import { createRefinementBundle } from "../services/refinementService.js";
import { logActivity } from "../services/activityService.js";

const createSchema = z.object({
  templateId: z.string().min(1),
  prompt: z.string().optional(),
  theme: z.string().optional(),
  difficulty: z.enum(["easy", "normal", "hard", "insane"]).optional(),
  customization: z.enum(["light", "medium", "heavy"]).optional(),
  extra: z.enum(["none", "powerups", "leaderboard", "boss"]).optional(),
  userId: z.string().optional()
});

const promptGenerateSchema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.any()).optional(),
  theme: z.string().optional(),
  difficulty: z.enum(["easy", "normal", "hard", "insane"]).optional(),
  customization: z.enum(["light", "medium", "heavy"]).optional(),
  extra: z.enum(["none", "powerups", "leaderboard", "boss"]).optional(),
  includePlan: z.boolean().optional(),
  includeCode: z.boolean().optional(),
  includeAssets: z.boolean().optional(),
  strategy: z.string().optional(),
  userId: z.string().optional()
});

const refineSchema = z.object({
  gamePackage: z.record(z.any()),
  request: z.string().optional(),
  refinementLevel: z.string().optional()
});

const exportCodeSchema = z.object({
  gamePackage: z.record(z.any())
});

export async function createGame(request, response, next) {
  try {
    const input = createSchema.parse(request.body);
    const game = createGamePackage(input);
    const persistence = await saveGamePackage(game);
    if (input.userId) {
      await logActivity({
        userId: input.userId,
        gameId: game.id,
        gameTitle: game.title,
        activityType: "create",
        details: `Created game "${game.title}" from template`
      });
    }
    response.status(201).json({ game, persistence });
  } catch (error) {
    next(error);
  }
}

export async function generateGame(request, response, next) {
  try {
    const input = promptGenerateSchema.parse(request.body);
    const result = await generateGameFromPrompt(input);
    const persistence = await saveGamePackage(result.game);
    if (input.userId) {
      await logActivity({
        userId: input.userId,
        gameId: result.game.id,
        gameTitle: result.game.title,
        activityType: "create",
        details: `Generated game "${result.game.title}" using AI`
      });
    }
    response.status(201).json({ ...result, persistence });
  } catch (error) {
    next(error);
  }
}

export async function refineGame(request, response, next) {
  try {
    const input = refineSchema.parse(request.body);
    const refinement = await createRefinementBundle(input);
    response.status(202).json({ refinement });
  } catch (error) {
    next(error);
  }
}

export async function exportGameCode(request, response, next) {
  try {
    const input = exportCodeSchema.parse(request.body);
    const { buffer, filename } = await buildGameCodeZip(input.gamePackage);

    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.send(buffer);
  } catch (error) {
    next(error);
  }
}
