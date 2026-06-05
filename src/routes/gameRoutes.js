import { Router } from "express";
import { createGame, exportGameCode, generateGame, refineGame } from "../controllers/gameController.js";

export const gameRouter = Router();

gameRouter.post("/create", createGame);
gameRouter.post("/generate-from-prompt", generateGame);
gameRouter.post("/refine", refineGame);
gameRouter.post("/export-code", exportGameCode);
