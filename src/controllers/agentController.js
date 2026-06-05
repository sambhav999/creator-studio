import { z } from "zod";
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
  refinementLevel: z.string().optional()
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

export async function generateCode(request, response, next) {
  try {
    const input = codeSchema.parse(request.body);
    const refinement = await createRefinementBundle(input);
    response.status(202).json({ task: "code-generation", refinement });
  } catch (error) {
    next(error);
  }
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
