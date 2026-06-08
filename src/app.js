import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { agentRouter } from "./routes/agentRoutes.js";
import { dashboardRouter } from "./routes/dashboardRoutes.js";
import { gameRouter } from "./routes/gameRoutes.js";
import { leaderboardRouter } from "./routes/leaderboardRoutes.js";
import { socialRouter } from "./routes/socialRoutes.js";
import { templateRouter } from "./routes/templateRoutes.js";
import { getDatabaseConfig } from "./services/databaseService.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getZeroGConfig } from "./services/zeroGService.js";

dotenv.config();

export const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",").map(origin => origin.trim()) ?? true,
  exposedHeaders: ["Content-Disposition"]
}));
app.use(express.json({ limit: "20mb" }));
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
      generateFromPrompt: "/api/games/generate-from-prompt",
      refineGame: "/api/games/refine",
      exportCode: "/api/games/export-code",
      agents: "/api/agents/stack",
      dashboard: "/api/dashboard",
      leaderboards: "/api/leaderboards/:gameId",
      social: "/api/social"
    },
    database: getDatabaseConfig(),
    agents: getZeroGConfig()
  });
});

const setupRoutes = (prefix) => {
  app.get(`${prefix}/health`, (_request, response) => {
    response.json({
      ok: true,
      service: "kult-creator-studio-api",
      strategy: "template-first-ai-optional",
      database: getDatabaseConfig(),
      agents: getZeroGConfig()
    });
  });

  app.use(`${prefix}/templates`, templateRouter);
  app.use(`${prefix}/games`, gameRouter);
  app.use(`${prefix}/leaderboards`, leaderboardRouter);
  app.use(`${prefix}/agents`, agentRouter);
  app.use(`${prefix}/dashboard`, dashboardRouter);
  app.use(`${prefix}/social`, socialRouter);
};

setupRoutes("/api");
setupRoutes("");

app.use(errorHandler);
