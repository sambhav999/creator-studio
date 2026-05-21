import { Router } from "express";
import { creatorDashboard } from "../controllers/dashboardController.js";

export const dashboardRouter = Router();

dashboardRouter.get("/creator", creatorDashboard);
