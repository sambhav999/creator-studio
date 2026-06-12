import { z } from "zod";
import {
  getGamePackageById,
  saveGamePackage,
  updateGamePackageFields
} from "../services/databaseService.js";
import { getJob, serializeJob, startJob } from "../services/jobService.js";
import { createRefinementBundle } from "../services/refinementService.js";
import {
  analyzeReferenceImage,
  createOrchestrationPlan,
  generateImageAsset,
  getZeroGConfig,
  runBackgroundTask,
  transcribeAudio
} from "../services/zeroGService.js";

const orchestrationSchema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.any()).optional()
});

const codeSchema = z.object({
  gamePackage: z.record(z.any()),
  request: z.string().optional(),
  refinementLevel: z.string().optional(),
  strategy: z.string().optional(),
  // Current build source — when present, the agent edits this code instead of
  // generating from a template seed (post-creation "wish" edits).
  baseCode: z.string().optional()
});

const backgroundSchema = z.object({
  task: z.string().min(1),
  input: z.any().optional()
});

const assetSchema = z.object({
  prompt: z.string().min(1),
  size: z.string().optional(),
  n: z.number().int().min(1).max(4).optional()
});

const visionSchema = z.object({
  prompt: z.string().optional(),
  imageUrl: z.string().url().optional(),
  imageBase64: z.string().optional(),
  mimeType: z.string().optional()
}).refine((value) => value.imageUrl || value.imageBase64, {
  message: "imageUrl or imageBase64 is required"
});

const speechSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().optional(),
  language: z.string().optional()
});

export function getAgentStack(_request, response) {
  response.json(getZeroGConfig());
}

export async function orchestrate(request, response, next) {
  try {
    const input = orchestrationSchema.parse(request.body);
    const result = await createOrchestrationPlan(input);
    response.json({ task: "orchestration", result });
  } catch (error) {
    next(error);
  }
}

// Code generation runs for minutes — return a jobId immediately and let the
// client poll GET /agents/jobs/:id instead of holding the request open.
export async function generateCode(request, response, next) {
  try {
    const input = codeSchema.parse(request.body);
    const requesterId = request.auth?.userId ?? null;
    const job = startJob("code-generation", async (updateProgress) => {
      const refinement = await createRefinementBundle(input, { onProgress: updateProgress });
      // Persist the build onto the saved game: without this, the generated
      // code lived only in the requesting browser tab and was lost on reload.
      // Field-targeted update — the thumbnail job may have already written its
      // cover URL onto this game, and a whole-package save would clobber it.
      if (input.gamePackage?.id) {
        try {
          // Only the game's creator may overwrite its stored build.
          const stored = await getGamePackageById(input.gamePackage.id);
          const owned = !stored?.creatorId || stored.creatorId === requesterId;
          if (owned) {
            if (stored) {
              await updateGamePackageFields(input.gamePackage.id, {
                tier: "ai-refinement",
                refinement
              });
            } else {
              // A confident local template match skips the initial prompt
              // routing request, so this code job may be the first backend
              // contact for the game. Persist it now so it can be published.
              await saveGamePackage({
                ...input.gamePackage,
                creatorId: requesterId ?? "anonymous",
                tier: "ai-refinement",
                refinement,
                publish: {
                  ...(input.gamePackage.publish ?? {}),
                  published: false,
                  status: "draft"
                }
              });
            }
          }
        } catch (error) {
          console.warn("Could not persist refinement to database", { message: error.message });
        }
      }
      return refinement;
    });
    response.status(202).json({ task: "code-generation", ...serializeJob(job) });
  } catch (error) {
    next(error);
  }
}

export async function getJobStatus(request, response) {
  const job = await getJob(request.params.jobId);
  if (!job) {
    response.status(404).json({ error: "Job not found or expired" });
    return;
  }
  response.json(serializeJob(job));
}

export async function backgroundTask(request, response, next) {
  try {
    const input = backgroundSchema.parse(request.body);
    const result = await runBackgroundTask(input);
    response.json({ task: "background", result });
  } catch (error) {
    next(error);
  }
}

export async function generateAssets(request, response, next) {
  try {
    const input = assetSchema.parse(request.body);
    const result = await generateImageAsset(input);
    response.status(202).json({ task: "image-assets", result });
  } catch (error) {
    next(error);
  }
}

export async function analyzeReference(request, response, next) {
  try {
    const input = visionSchema.parse(request.body);
    const result = await analyzeReferenceImage(input);
    response.json({ task: "vision-reference", result });
  } catch (error) {
    next(error);
  }
}

export async function transcribeVoice(request, response, next) {
  try {
    const input = speechSchema.parse(request.body);
    const result = await transcribeAudio(input);
    response.json({ task: "speech-to-text", result });
  } catch (error) {
    next(error);
  }
}
