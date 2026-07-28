import { Router } from "express";
import { z } from "zod";
import {
  enrichAuthPayload,
  getAuthConfig,
  requireAuth,
  signToken,
  verifyPrivySession,
} from "../services/authService.js";
import { attributeNewUser, requestIp } from "../services/referralService.js";
import { logActivityOnChain, ACTIVITY } from "../services/zeroGActivityLog.js";
import {
  createWalletLinkChallenge,
  verifyWalletLinkSignature,
} from "../services/walletLinkService.js";

const tokenSchema = z.object({
  privyAccessToken: z.string().min(1).optional().nullable(),
  privyIdentityToken: z.string().min(1).optional().nullable(),
});

const walletChallengeSchema = z
  .object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .strict();

const walletLinkSchema = z
  .object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    message: z.string().min(20),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  })
  .strict();

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

authRouter.post("/wallet/challenge", requireAuth, (request, response, next) => {
  try {
    const input = walletChallengeSchema.parse(request.body ?? {});
    const auth = enrichAuthPayload(request.auth ?? {});
    response.json(
      createWalletLinkChallenge({
        privyUserId: auth.privyUserId ?? auth.userId,
        address: input.address,
      }),
    );
  } catch (error) {
    next(error);
  }
});

authRouter.post("/wallet/link", requireAuth, (request, response, next) => {
  try {
    const input = walletLinkSchema.parse(request.body ?? {});
    const auth = enrichAuthPayload(request.auth ?? {});
    const evmWalletAddress = verifyWalletLinkSignature({
      message: input.message,
      signature: input.signature,
      address: input.address,
      privyUserId: auth.privyUserId ?? auth.userId,
    });
    const identityAliases = [
      ...(Array.isArray(auth.identityAliases) ? auth.identityAliases : []),
      auth.userId,
      auth.privyUserId,
      evmWalletAddress,
    ].filter(Boolean);
    const token = signToken({
      userId: evmWalletAddress,
      privyUserId: auth.privyUserId,
      privySessionId: auth.privySessionId,
      evmWalletAddress,
      tonWalletAddress: auth.tonWalletAddress,
      telegramUserId: auth.telegramUserId,
      identityAliases: [...new Set(identityAliases.map((value) => String(value).toLowerCase()))],
    });
    response.json({
      token,
      userId: evmWalletAddress,
      evmWalletAddress,
      identityAliases: [...new Set(identityAliases)],
    });
  } catch (error) {
    next(error);
  }
});
