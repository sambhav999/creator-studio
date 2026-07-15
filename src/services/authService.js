import jwt from "jsonwebtoken";
import { verifyAccessToken, verifyIdentityToken } from "@privy-io/node";

// JWT configuration comes from the environment:
//   JWT_SECRET          — signing secret (required; no insecure default)
//   JWT_EXPIRATION_DAYS — token lifetime in days (default 7)

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error("JWT_SECRET is not configured");
    error.status = 500;
    throw error;
  }
  return secret;
}

function getExpirationDays() {
  const days = Number(process.env.JWT_EXPIRATION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

export function getAuthConfig() {
  return {
    configured: Boolean(process.env.JWT_SECRET),
    expirationDays: getExpirationDays(),
    privyConfigured: Boolean(process.env.PRIVY_APP_ID && process.env.PRIVY_VERIFICATION_KEY)
  };
}

export function getPrivyAuthConfig() {
  return {
    appId: process.env.PRIVY_APP_ID,
    verificationKey: process.env.PRIVY_VERIFICATION_KEY,
    configured: Boolean(process.env.PRIVY_APP_ID && process.env.PRIVY_VERIFICATION_KEY)
  };
}

function getLinkedAccounts(user) {
  return user?.linked_accounts ?? user?.linkedAccounts ?? [];
}

function accountChainType(account) {
  return account?.chain_type ?? account?.chainType ?? null;
}

function normalizeAddress(address) {
  const value = String(address || "").trim();
  if (!value) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function extractPrivyIdentity(user, fallbackUserId) {
  const accounts = getLinkedAccounts(user);
  const wallets = accounts.filter((account) => account?.type === "wallet" && account.address);
  const tonWallet = wallets.find((account) => accountChainType(account) === "ton");
  const evmWallet = wallets.find((account) => accountChainType(account) === "ethereum" && account.address);
  const firstWallet = wallets[0] ?? user?.wallet ?? null;
  const telegram = accounts.find((account) => account?.type === "telegram") ?? user?.telegram ?? null;
  const telegramUserId = telegram?.telegram_user_id ?? telegram?.telegramUserId ?? null;
  const privyUserId = user?.id ?? fallbackUserId ?? null;
  const evmWalletAddress = normalizeAddress(evmWallet?.address);
  const tonWalletAddress = normalizeAddress(tonWallet?.address);
  const fallbackWalletAddress = normalizeAddress(firstWallet?.address);
  const telegramAlias = telegramUserId ? `tg_${telegramUserId}` : null;

  return {
    userId: privyUserId ?? tonWalletAddress ?? evmWalletAddress ?? fallbackWalletAddress ?? telegramAlias,
    privyUserId,
    evmWalletAddress,
    tonWalletAddress,
    telegramUserId: telegramUserId ? String(telegramUserId) : null,
    identityAliases: unique([
      privyUserId,
      tonWalletAddress,
      evmWalletAddress,
      fallbackWalletAddress,
      telegramAlias
    ])
  };
}

export function derivePrivyUserId(user, fallbackUserId) {
  return extractPrivyIdentity(user, fallbackUserId).userId;
}

function hasPrivyToken(accessToken, identityToken) {
  return Boolean(accessToken || identityToken);
}

export async function verifyPrivySession({ accessToken, identityToken }) {
  if (!hasPrivyToken(accessToken, identityToken)) return null;

  const config = getPrivyAuthConfig();
  if (!config.configured) {
    if (process.env.NODE_ENV === "production") {
      const error = new Error("Privy auth is not configured");
      error.status = 500;
      throw error;
    }
    return null;
  }

  const verifiedAccess = accessToken
    ? await verifyAccessToken({
        access_token: accessToken,
        app_id: config.appId,
        verification_key: config.verificationKey
      })
    : null;

  const verifiedUser = identityToken
    ? await verifyIdentityToken({
        identity_token: identityToken,
        app_id: config.appId,
        verification_key: config.verificationKey
      })
    : null;

  if (!verifiedAccess && !verifiedUser) {
    const error = new Error("Privy token required");
    error.status = 401;
    throw error;
  }

  if (verifiedAccess && verifiedUser && verifiedAccess.user_id !== verifiedUser.id) {
    const error = new Error("Privy token user mismatch");
    error.status = 401;
    throw error;
  }

  const identity = extractPrivyIdentity(verifiedUser, verifiedAccess?.user_id);
  const userId = identity.userId;
  if (!userId) {
    const error = new Error("Could not resolve Privy identity");
    error.status = 401;
    throw error;
  }

  return {
    userId,
    privyUserId: identity.privyUserId,
    privySessionId: verifiedAccess?.session_id,
    evmWalletAddress: identity.evmWalletAddress,
    tonWalletAddress: identity.tonWalletAddress,
    telegramUserId: identity.telegramUserId,
    identityAliases: identity.identityAliases
  };
}

/** Signs a JWT for the given payload (e.g. { userId }). */
export function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: `${getExpirationDays()}d`
  });
}

/** Verifies a token and returns its payload, or throws a 401 error. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (cause) {
    const error = new Error(
      cause.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
      { cause }
    );
    error.status = 401;
    throw error;
  }
}

/**
 * Express middleware: requires a valid `Authorization: Bearer <token>` header
 * and attaches the decoded payload as request.auth.
 */
export function requireAuth(request, response, next) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    response.status(401).json({ error: "Authorization token required" });
    return;
  }

  try {
    request.auth = verifyToken(token);
    next();
  } catch (error) {
    response.status(error.status ?? 401).json({ error: error.message });
  }
}

/**
 * Attaches a verified identity when a Bearer token is present, while allowing
 * genuinely public requests to continue without one.
 */
export function optionalAuth(request, response, next) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    next();
    return;
  }

  try {
    request.auth = verifyToken(token);
    next();
  } catch (error) {
    response.status(error.status ?? 401).json({ error: error.message });
  }
}
