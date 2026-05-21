import { Router } from "express";
import { createGame, exportGameCode, refineGame } from "../controllers/gameController.js";

export const gameRouter = Router();

gameRouter.post("/create", createGame);
gameRouter.post("/refine", refineGame);
gameRouter.post("/export-code", exportGameCode);
