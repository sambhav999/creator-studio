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
  origin: process.env.CORS_ORIGIN?.split(",").map(origin => origin.trim()) ?? true,
  exposedHeaders: ["Content-Disposition"]
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
      exportCode: "/api/games/export-code",
      dashboard: "/api/dashboard"
    },
    database: getDatabaseConfig()
  });
});

const setupRoutes = (prefix) => {
  app.get(`${prefix}/health`, (_request, response) => {
    response.json({
      ok: true,
      service: "kult-creator-studio-api",
      strategy: "template-first-ai-optional",
      database: getDatabaseConfig()
    });
  });

  app.use(`${prefix}/templates`, templateRouter);
  app.use(`${prefix}/games`, gameRouter);
  app.use(`${prefix}/dashboard`, dashboardRouter);
};

setupRoutes("/api");
setupRoutes("");

app.use(errorHandler);
