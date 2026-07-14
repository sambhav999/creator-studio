import { Router } from "express";
import { z } from "zod";
import { getAuthConfig, signToken, verifyPrivySession } from "../services/authService.js";
import { attributeNewUser, requestIp } from "../services/referralService.js";

const tokenSchema = z.object({
  userId: z.string().min(1).max(256).optional(),
  privyAccessToken: z.string().min(1).optional().nullable(),
  privyIdentityToken: z.string().min(1).optional().nullable()
});

export const authRouter = Router();

authRouter.get("/config", (_request, response) => {
  response.json(getAuthConfig());
});

// Issues a JWT for the given (or generated anonymous) user id. There is no
// user database yet, so this is identity plumbing rather than authentication —
// it lets every write endpoint require a signed token end to end.
function referralCookie(request) {
  const raw = request.headers.cookie || "";
  const match = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith("kult_ref="));
  return match ? decodeURIComponent(match.slice("kult_ref=".length)) : null;
}

authRouter.post("/token", async (request, response, next) => {
  try {
    const input = tokenSchema.parse(request.body ?? {});
    const privySession = await verifyPrivySession({
      accessToken: input.privyAccessToken,
      identityToken: input.privyIdentityToken
    });
    const userId = privySession?.userId ?? input.userId ?? `anon_${Date.now().toString(36)}`;
    await attributeNewUser({
      userId,
      code: referralCookie(request),
      ip: requestIp(request),
    }).catch((error) => {
      // Referral accounting must never block sign-in.
      console.warn("Could not process referral attribution", { message: error.message });
    });
    const token = signToken({
      userId,
      privyUserId: privySession?.privyUserId,
      privySessionId: privySession?.privySessionId
    });
    response.clearCookie("kult_ref", { path: "/" });
    response.json({
      token,
      userId,
      privyUserId: privySession?.privyUserId,
      expirationDays: getAuthConfig().expirationDays
    });
  } catch (error) {
    next(error);
  }
});
