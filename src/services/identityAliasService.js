function normalizeIdentity(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : raw;
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
  const normalized = normalizeIdentity(identity);
  if (!normalized) return false;
  return authIdentityAliases(auth).includes(normalized);
}

export function creatorFilterForAuth(auth, requestedCreatorId) {
  const aliases = authIdentityAliases(auth);
  if (aliases.length > 0) return aliases;
  return [normalizeIdentity(requestedCreatorId)].filter(Boolean);
}
