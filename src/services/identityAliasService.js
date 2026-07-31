import { Address } from "@ton/core";

function normalizeIdentity(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : raw;
}

// Reduces an identity to a single canonical string for MATCHING only (not for
// DB queries). A TON wallet has several valid forms for the same wallet
// (bounceable EQ…, non-bounceable UQ…, raw 0:…); collapse them to raw form so
// ownership checks succeed regardless of which form the caller sent. Everything
// else is compared lowercased.
function canonicalForMatch(value) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return null;
  try {
    return Address.parse(normalized).toRawString().toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

export function authIdentityAliases(auth) {
  return [
    auth?.userId,
    auth?.privyUserId,
    auth?.evmWalletAddress,
    auth?.tonWalletAddress,
    auth?.telegramUserId ? `tg_${auth.telegramUserId}` : null,
    ...(Array.isArray(auth?.identityAliases) ? auth.identityAliases : [])
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

export function authOwnsIdentity(auth, identity) {
  const target = canonicalForMatch(identity);
  if (!target) return false;
  // Compare on canonical forms so a TON address in EQ/UQ/raw form still matches
  // the same wallet stored in the caller's alias set. The alias forms returned
  // by authIdentityAliases (used for DB queries) are unchanged.
  return authIdentityAliases(auth).some((alias) => canonicalForMatch(alias) === target);
}

export function creatorFilterForAuth(auth, requestedCreatorId) {
  const aliases = authIdentityAliases(auth);
  if (aliases.length > 0) return aliases;
  return [normalizeIdentity(requestedCreatorId)].filter(Boolean);
}
