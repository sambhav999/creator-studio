import { Router } from "express";
import { z } from "zod";
import { getAuthConfig, signToken } from "../services/authService.js";

const tokenSchema = z.object({
  userId: z.string().min(1).max(128).optional()
});

export const authRouter = Router();

authRouter.get("/config", (_request, response) => {
  response.json(getAuthConfig());
});

// Issues a JWT for the given (or generated anonymous) user id. There is no
// user database yet, so this is identity plumbing rather than authentication —
// it lets every write endpoint require a signed token end to end.
authRouter.post("/token", (request, response, next) => {
  try {
    const input = tokenSchema.parse(request.body ?? {});
    const userId = input.userId ?? `anon_${Date.now().toString(36)}`;
    const token = signToken({ userId });
    response.json({ token, userId, expirationDays: getAuthConfig().expirationDays });
  } catch (error) {
    next(error);
  }
});
