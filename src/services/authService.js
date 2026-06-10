import jwt from "jsonwebtoken";

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
    expirationDays: getExpirationDays()
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
