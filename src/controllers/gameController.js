import { z } from "zod";
import { buildGameCodeZip } from "../services/codeExportService.js";
import {
  deleteGamePackage,
  getGamePackageById,
  listGamePackages,
  saveGamePackage,
  updateGamePackageFields
} from "../services/databaseService.js";
import { createGamePackage } from "../services/gameFactoryService.js";
import { startJob } from "../services/jobService.js";
import { generateGameFromPrompt } from "../services/promptPipelineService.js";
import { createRefinementBundle } from "../services/refinementService.js";
import { generateAndStoreGameThumbnail } from "../services/thumbnailService.js";
import { logActivity } from "../services/activityService.js";
import { putBufferOnZeroG } from "../services/zeroGStorage.js";
import { awardFirstGameBonus, recordCreatorGamePublished } from "../services/pointsService.js";

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

// Created games were previously only visible in the browser that generated
// them (localStorage). This lists what the backend actually saved so the
// frontend can show every creation.
export async function listGames(request, response, next) {
  try {
    const limit = Math.min(Number(request.query.limit) || 50, 100);
    const search = request.query.search || request.query.q;
    const creatorId = request.query.creatorId;
    if (creatorId && creatorId !== request.auth?.userId) {
      response.status(403).json({ error: "You can only list your own draft games" });
      return;
    }
    const ids = request.query.ids
      ? String(request.query.ids).split(",").map((id) => id.trim()).filter(Boolean).slice(0, 100)
      : undefined;
    const games = await listGamePackages({
      limit,
      search,
      creatorId,
      ids,
      publishedOnly: !creatorId
    });
    response.json({ games });
  } catch (error) {
    next(error);
  }
}

export async function showPublicGame(request, response, next) {
  try {
    const game = await getGamePackageById(request.params.gameId);
    if (!game || game.publish?.published !== true) {
      response.status(404).json({ error: "Published game not found" });
      return;
    }
    response.json({ game });
  } catch (error) {
    next(error);
  }
}

export async function showManagedGame(request, response, next) {
  try {
    const game = await getGamePackageById(request.params.gameId);
    if (!game) {
      response.status(404).json({ error: "Game not found" });
      return;
    }
    if (game.creatorId && game.creatorId !== request.auth?.userId) {
      response.status(403).json({ error: "Only the creator can access this draft" });
      return;
    }
    response.json({ game });
  } catch (error) {
    next(error);
  }
}

function canPublish(game) {
  if (game?.templateId === "pure-agent") {
    return Boolean(game?.refinement?.generatedCode);
  }
  return Boolean(game?.refinement?.generatedCode || game?.build?.publishReady);
}

export async function publishGame(request, response, next) {
  try {
    const game = await getGamePackageById(request.params.gameId);
    if (!game) {
      response.status(404).json({ error: "Game not found" });
      return;
    }
    if (game.creatorId && game.creatorId !== request.auth?.userId) {
      response.status(403).json({ error: "Only the creator can publish this game" });
      return;
    }
    if (!canPublish(game)) {
      response.status(409).json({
        error: "This game is still building. Publish it after a playable build is ready."
      });
      return;
    }

    const publishedAt = new Date();
    const publish = {
      ...(game.publish ?? {}),
      published: true,
      status: "published",
      publishedAt,
      playPath: `/studio/play/${game.id}`
    };
    await updateGamePackageFields(game.id, { publish });
    await logActivity({
      userId: request.auth?.userId,
      gameId: game.id,
      gameTitle: game.title,
      activityType: "publish",
      details: `Published game "${game.title}"`
    });
    await recordCreatorGamePublished({
      creatorId: game.creatorId ?? request.auth?.userId,
      gameId: game.id,
    }).catch(() => null);
    const points = await awardFirstGameBonus({
      creatorId: game.creatorId ?? request.auth?.userId,
      gameId: game.id,
    }).catch(() => null);
    response.json({
      ok: true,
      game: { ...game, publish },
      playPath: publish.playPath,
      points
    });
  } catch (error) {
    next(error);
  }
}

export async function unpublishGame(request, response, next) {
  try {
    const game = await getGamePackageById(request.params.gameId);
    if (!game) {
      response.status(404).json({ error: "Game not found" });
      return;
    }
    if (game.creatorId && game.creatorId !== request.auth?.userId) {
      response.status(403).json({ error: "Only the creator can unpublish this game" });
      return;
    }

    const publish = {
      ...(game.publish ?? {}),
      published: false,
      status: "draft",
      unpublishedAt: new Date()
    };
    await updateGamePackageFields(game.id, { publish });
    await logActivity({
      userId: request.auth?.userId,
      gameId: game.id,
      gameTitle: game.title,
      activityType: "unpublish",
      details: `Unpublished game "${game.title}"`
    });
    response.json({ ok: true, game: { ...game, publish } });
  } catch (error) {
    next(error);
  }
}

const saveSchema = z.object({
  gamePackage: z.record(z.any())
});

// Saves an edited game (title, settings, code) from the post-creation editor.
// Only the creator may modify their game — wallet identity is the user.
export async function saveGame(request, response, next) {
  try {
    const input = saveSchema.parse(request.body);
    const existing = await getGamePackageById(request.params.gameId);
    const requester = request.auth?.userId;
    if (existing?.creatorId && existing.creatorId !== requester) {
      response.status(403).json({ error: "Only the creator can edit this game" });
      return;
    }
    const gamePackage = {
      ...input.gamePackage,
      id: request.params.gameId,
      // ownership is immutable through this endpoint
      creatorId: existing?.creatorId ?? input.gamePackage.creatorId ?? requester ?? "anonymous",
      // Publication is controlled by the dedicated publish endpoints so a
      // normal save cannot accidentally expose a draft or unpublish a game.
      publish: existing?.publish ?? input.gamePackage.publish ?? {
        published: false,
        status: "draft"
      }
    };
    const persistence = await saveGamePackage(gamePackage);
    await logActivity({
      userId: gamePackage.creatorId,
      gameId: gamePackage.id,
      gameTitle: gamePackage.title,
      activityType: "major_edit",
      details: `Saved changes to "${gamePackage.title || gamePackage.id}"`
    });
    response.json({ ok: true, game: gamePackage, persistence });
  } catch (error) {
    next(error);
  }
}

export async function deleteGame(request, response, next) {
  try {
    const existing = await getGamePackageById(request.params.gameId);
    const requester = request.auth?.userId;
    if (existing?.creatorId && existing.creatorId !== requester) {
      response.status(403).json({ error: "Only the creator can delete this game" });
      return;
    }
    const { deleted } = await deleteGamePackage(request.params.gameId);
    if (!deleted) {
      response.status(404).json({ error: "Game not found" });
      return;
    }
    response.json({ ok: true, deleted: request.params.gameId });
  } catch (error) {
    next(error);
  }
}

export async function createGame(request, response, next) {
  try {
    const input = createSchema.parse(request.body);
    const game = createGamePackage(input);
    game.creatorId = request.auth?.userId ?? "anonymous";
    const persistence = await saveGamePackage(game);
    if (game.creatorId) {
      await logActivity({
        userId: game.creatorId,
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
    // Attribute the game to its creator so follows and profile stats are real.
    result.game.creatorId = request.auth?.userId ?? "anonymous";
    result.game.publish = {
      ...(result.game.publish ?? {}),
      published: false,
      status: "draft"
    };
    const persistence = await saveGamePackage(result.game);

    // Every generated game (hybrid and pure-agent) gets a real cover image:
    // generated by the image model, downloaded, and stored in the thumbnails
    // collection. Runs in parallel as a background job — the response is not
    // delayed, and the game record is updated when the image lands.
    const thumbnailJob = startJob("thumbnail-generation", () =>
      generateAndStoreGameThumbnail(result.game)
    );
    result.game.thumbnailJobId = thumbnailJob.id;
    if (result.game.creatorId) {
      await logActivity({
        userId: result.game.creatorId,
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
    const zeroGStorage = await putBufferOnZeroG({
      objectType: "game-export-zip",
      objectId: input.gamePackage.id ?? filename,
      buffer,
      contentType: "application/zip",
      fileName: filename,
      metadata: {
        gameId: input.gamePackage.id ?? null,
        title: input.gamePackage.title ?? null,
        creatorId: input.gamePackage.creatorId ?? null
      }
    });

    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.setHeader("X-0G-Storage-Status", zeroGStorage.status);
    if (zeroGStorage.rootHash) response.setHeader("X-0G-Root-Hash", zeroGStorage.rootHash);
    if (zeroGStorage.txHash) response.setHeader("X-0G-Tx-Hash", zeroGStorage.txHash);
    if (zeroGStorage.uri) response.setHeader("X-0G-URI", zeroGStorage.uri);
    response.send(buffer);
  } catch (error) {
    next(error);
  }
}
