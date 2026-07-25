import { Router } from "express";
import { z } from "zod";
import { getAuthConfig, signToken, verifyPrivySession } from "../services/authService.js";
import { attributeNewUser, requestIp } from "../services/referralService.js";
import { logActivityOnChain, ACTIVITY } from "../services/zeroGActivityLog.js";

const tokenSchema = z.object({
  privyAccessToken: z.string().min(1).optional().nullable(),
  privyIdentityToken: z.string().min(1).optional().nullable()
});

export const authRouter = Router();

authRouter.get("/config", (_request, response) => {
  response.json(getAuthConfig());
});

// Issues an application JWT only after Privy has verified the caller.
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
    const userId = privySession.userId;
    // 0G on-chain: log a login/session-start event.
    logActivityOnChain(ACTIVITY.LOGIN, userId);
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
      privyUserId: privySession.privyUserId,
      privySessionId: privySession.privySessionId,
      evmWalletAddress: privySession.evmWalletAddress,
      tonWalletAddress: privySession.tonWalletAddress,
      telegramUserId: privySession.telegramUserId,
      identityAliases: privySession.identityAliases
    });
    response.clearCookie("kult_ref", { path: "/" });
    response.json({
      token,
      userId,
      privyUserId: privySession.privyUserId,
      evmWalletAddress: privySession.evmWalletAddress,
      tonWalletAddress: privySession.tonWalletAddress,
      telegramUserId: privySession.telegramUserId,
      identityAliases: privySession.identityAliases,
      expirationDays: getAuthConfig().expirationDays
    });
  } catch (error) {
    next(error);
  }
});
