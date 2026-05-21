import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { dashboardRouter } from "./routes/dashboardRoutes.js";
import { gameRouter } from "./routes/gameRoutes.js";
import { templateRouter } from "./routes/templateRoutes.js";
import { getDatabaseConfig } from "./services/databaseService.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

export const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",").map(origin => origin.trim()) ?? true
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    service: "kult-creator-studio-api",
    message: "Backend is running. Use the /api routes for data.",
    endpoints: {
      health: "/api/health",
      templates: "/api/templates",
      createGame: "/api/games/create",
      refineGame: "/api/games/refine",
      dashboard: "/api/dashboard"
    },
    database: getDatabaseConfig()
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "kult-creator-studio-api",
    strategy: "template-first-ai-optional",
    database: getDatabaseConfig()
  });
});

app.use("/api/templates", templateRouter);
app.use("/api/games", gameRouter);
app.use("/api/dashboard", dashboardRouter);
app.use(errorHandler);
