import { Router } from "express";
import {
  analyzeReference,
  backgroundTask,
  generateAssets,
  generateCode,
  getAgentStack,
  orchestrate,
  transcribeVoice
} from "../controllers/agentController.js";

export const agentRouter = Router();

agentRouter.get("/stack", getAgentStack);
agentRouter.post("/orchestrate", orchestrate);
agentRouter.post("/code", generateCode);
agentRouter.post("/background", backgroundTask);
agentRouter.post("/assets", generateAssets);
agentRouter.post("/vision", analyzeReference);
agentRouter.post("/transcribe", transcribeVoice);
