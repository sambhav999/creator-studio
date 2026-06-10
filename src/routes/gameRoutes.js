import { Router } from "express";
import { createGame, deleteGame, exportGameCode, generateGame, listGames, refineGame } from "../controllers/gameController.js";
import { requireAuth } from "../services/authService.js";

export const gameRouter = Router();

gameRouter.get("/list", listGames);
gameRouter.post("/create", requireAuth, createGame);
gameRouter.post("/generate-from-prompt", requireAuth, generateGame);
gameRouter.post("/refine", requireAuth, refineGame);
gameRouter.post("/export-code", requireAuth, exportGameCode);
gameRouter.delete("/:gameId", requireAuth, deleteGame);
