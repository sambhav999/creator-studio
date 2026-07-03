import { getDatabase, getDatabaseByName, getGameCollection } from "./databaseService.js";

export const POINT_VALUES = Object.freeze({
  playerPlay: 10,
  creatorPlay: 2,
  playerFirstPlay: 30,
  creatorFirstPlay: 10,
  playerReplay: 5,
  creatorReplay: 2,
  playerLike: 2,
  creatorLike: 15,
  playerShare: 10,
  creatorShare: 25,
  playerFollow: 20,
  creatorFollow: 40,
  playerPublish: 50,
  creatorPublish: 100,
  referralInviterKp: 200,
  referralFriendKp: 100,
  referralInviterCs: 100,

  // Backward-compatible aliases used by older call sites.
  qualifiedPlay: 2,
  like: 15,
  share: 25,
  follow: 40,
  referralPlay: 200,
  firstGameBonus: 100,
});

const PLAY_REWARD_DAILY_CAP = 50;
const DEFAULT_BROWSER_DB = "kult_browser";
const DEFAULT_COLLECTIONS = Object.freeze({
  playerKpLedger: "player_kp_ledger",
  browserBalances: "kult_points",
  creatorScoreLedger: "creator_score_ledger",
  creatorScoreBalances: "creator_score_balances",
  creators: "creators",
});

let indexesReady;
let testHarness = null;

function collectionName(key) {
  const envKey = `DUAL_ECONOMY_${key.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()}_COLLECTION`;
  return process.env[envKey] || DEFAULT_COLLECTIONS[key];
}

function browserDatabaseName() {
  return process.env.KULT_POINTS_DB || process.env.KULT_BROWSER_DB || DEFAULT_BROWSER_DB;
}

function normalizeUserId(userId) {
  const value = String(userId || "").trim();
  return /^0x/i.test(value) ? value.toLowerCase() : value;
}

function sameUser(a, b) {
  return Boolean(normalizeUserId(a) && normalizeUserId(a) === normalizeUserId(b));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function weekKey(date) {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(utc).getUTCDay() || 7;
  const thursday = new Date(utc);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodIncrements(field, amount, now) {
  const day = dayKey(now);
  const week = weekKey(now);
  return {
    [`lifetime${field}`]: amount,
    [`daily${field}.${day}`]: amount,
    [`weekly${field}.${week}`]: amount,
  };
}

function periodState(now) {
  return {
    currentDay: dayKey(now),
    currentWeek: weekKey(now),
    updatedAt: now,
  };
}

async function collections() {
  if (testHarness?.collections) return testHarness.collections;

  const [studioDb, browserDb] = await Promise.all([
    getDatabase(),
    getDatabaseByName(browserDatabaseName()),
  ]);

  const playerKpLedger = studioDb.collection(collectionName("playerKpLedger"));
  const browserBalances = browserDb.collection(collectionName("browserBalances"));
  const creatorScoreLedger = studioDb.collection(collectionName("creatorScoreLedger"));
  const creatorScoreBalances = studioDb.collection(collectionName("creatorScoreBalances"));
  const creators = studioDb.collection(collectionName("creators"));

  if (!indexesReady) {
    indexesReady = Promise.allSettled([
      playerKpLedger.createIndex({ eventId: 1 }, { unique: true, name: "player_kp_eventId_unique" }),
      playerKpLedger.createIndex({ userId: 1, action: 1, targetGameId: 1, day: 1 }, { name: "player_kp_user_action_game_day" }),
      browserBalances.createIndex({ walletAddress: 1 }, { unique: true, name: "kult_points_walletAddress_unique" }),
      browserBalances.createIndex({ kultPoints: -1 }, { name: "kult_points_score_desc" }),
      creatorScoreLedger.createIndex({ eventId: 1 }, { unique: true, name: "creator_score_eventId_unique" }),
      creatorScoreLedger.createIndex({ creatorId: 1, action: 1, targetGameId: 1, day: 1 }, { name: "creator_score_creator_action_game_day" }),
      creatorScoreBalances.createIndex({ creatorId: 1 }, { unique: true, name: "creator_score_creatorId_unique" }),
      creators.createIndex({ creatorId: 1 }, { unique: true, name: "creators_creatorId_unique" }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn("Dual economy index setup skipped", { message: result.reason?.message });
        }
      }
    });
  }
  await indexesReady;

  return { playerKpLedger, browserBalances, creatorScoreLedger, creatorScoreBalances, creators };
}

export function buildPointEventId(type, parts) {
  return ["creator-studio", type, ...parts.map((part) => String(part ?? "none"))].join(":");
}

async function insertLedgerEvent(collection, event) {
  const insertResult = await collection.updateOne(
    { eventId: event.eventId },
    { $setOnInsert: event },
    { upsert: true },
  );
  return Boolean(insertResult.upsertedCount);
}

export async function awardPlayerKp({
  eventId,
  userId,
  action,
  kp,
  targetGameId,
  sourceUserId,
  metadata = {},
  now = new Date(),
}) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return { awarded: false, reason: "missing-user", kp: 0 };

  const amount = Number(kp);
  if (!Number.isFinite(amount) || amount <= 0) return { awarded: false, reason: "invalid-kp", kp: 0 };

  const { playerKpLedger, browserBalances } = await collections();
  const event = {
    eventId,
    source: "creator-studio",
    economy: "kp",
    action,
    userId: normalizedUserId,
    kpDelta: amount,
    targetGameId: targetGameId ?? null,
    sourceUserId: sourceUserId ? normalizeUserId(sourceUserId) : null,
    day: dayKey(now),
    week: weekKey(now),
    metadata,
    createdAt: now,
  };

  const awarded = await insertLedgerEvent(playerKpLedger, event);
  if (!awarded) {
    return { awarded: false, duplicate: true, kp: 0 };
  }

  await browserBalances.updateOne(
    { walletAddress: normalizedUserId },
    {
      $inc: { kultPoints: amount },
      $set: { walletAddress: normalizedUserId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return { awarded: true, kp: amount };
}

export async function awardCreatorScore({
  eventId,
  creatorId,
  action,
  cs,
  targetGameId,
  sourceUserId,
  metadata = {},
  now = new Date(),
}) {
  const normalizedCreatorId = normalizeUserId(creatorId);
  if (!normalizedCreatorId) return { awarded: false, reason: "missing-creator", cs: 0 };

  const amount = Number(cs);
  if (!Number.isFinite(amount) || amount <= 0) return { awarded: false, reason: "invalid-cs", cs: 0 };

  const { creatorScoreLedger, creatorScoreBalances, creators } = await collections();
  const event = {
    eventId,
    source: "creator-studio",
    economy: "cs",
    action,
    creatorId: normalizedCreatorId,
    csDelta: amount,
    targetGameId: targetGameId ?? null,
    sourceUserId: sourceUserId ? normalizeUserId(sourceUserId) : null,
    day: dayKey(now),
    week: weekKey(now),
    metadata,
    createdAt: now,
  };

  const awarded = await insertLedgerEvent(creatorScoreLedger, event);
  if (!awarded) {
    const balance = await creatorScoreBalances.findOne({ creatorId: normalizedCreatorId }, { projection: { _id: 0 } });
    return { awarded: false, duplicate: true, cs: 0, balance };
  }

  const legacyPointIncrements = periodIncrements("Points", amount, now);
  const scoreIncrements = periodIncrements("Score", amount, now);
  const state = periodState(now);

  await Promise.all([
    creatorScoreBalances.updateOne(
      { creatorId: normalizedCreatorId },
      {
        $inc: { ...scoreIncrements, ...legacyPointIncrements },
        $set: state,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    ),
    creators.updateOne(
      { creatorId: normalizedCreatorId },
      {
        $inc: { ...scoreIncrements, ...legacyPointIncrements },
        $set: state,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    ),
  ]);

  const balance = await creatorScoreBalances.findOne({ creatorId: normalizedCreatorId }, { projection: { _id: 0 } });
  return { awarded: true, cs: amount, balance };
}

async function getPlayerGamePlayCount(playerKpLedger, userId, gameId) {
  return playerKpLedger.countDocuments({
    userId,
    action: "game_play_qualified",
    targetGameId: gameId,
  });
}

async function getPlayerGamePlayCountForDay(playerKpLedger, userId, gameId, now) {
  return playerKpLedger.countDocuments({
    userId,
    action: "game_play_qualified",
    targetGameId: gameId,
    day: dayKey(now),
  });
}

async function updateGamePoints(gameId, inc) {
  if (!gameId) return null;
  const games = testHarness?.gameCollection ?? await getGameCollection();
  const current = await games.findOne({ id: gameId }, { projection: { _id: 0, points: 1 } });
  const points = {
    plays: Math.max(0, Number(current?.points?.plays ?? 0) + Number(inc.plays ?? 0)),
    likes: Math.max(0, Number(current?.points?.likes ?? 0) + Number(inc.likes ?? 0)),
    shares: Math.max(0, Number(current?.points?.shares ?? 0) + Number(inc.shares ?? 0)),
    total: Math.max(0, Number(current?.points?.total ?? 0) + Number(inc.total ?? 0)),
  };
  await games.updateOne(
    { id: gameId },
    { $set: { points, updatedAt: new Date() } },
  );
  return points;
}

function dualAwardResult({ playerKp, creatorScore, action, pointsForGame }) {
  const awarded = Boolean(playerKp?.awarded || creatorScore?.awarded);
  return {
    awarded,
    duplicate: Boolean(!awarded && (playerKp?.duplicate || creatorScore?.duplicate)),
    action,
    playerKp,
    creatorScore,
    kp: playerKp?.kp ?? 0,
    cs: creatorScore?.cs ?? 0,
    // Legacy fields while frontend responses are migrated.
    points: creatorScore?.cs ?? 0,
    gamePoints: pointsForGame ?? null,
  };
}

export async function awardQualifiedPlay({ game, actorId, sessionId, durationSeconds, now = new Date() }) {
  if (!game?.id || !game?.creatorId || !actorId || Number(durationSeconds) < 30) {
    return { awarded: false, reason: "not-qualified", playerKp: null, creatorScore: null };
  }
  if (sameUser(game.creatorId, actorId)) {
    return { awarded: false, reason: "self-play", playerKp: null, creatorScore: null };
  }

  const creatorId = normalizeUserId(game.creatorId);
  const playerId = normalizeUserId(actorId);
  const { playerKpLedger } = await collections();
  const dayCount = await getPlayerGamePlayCountForDay(playerKpLedger, playerId, game.id, now);
  if (dayCount >= PLAY_REWARD_DAILY_CAP) {
    return { awarded: false, reason: "play-daily-cap", playerKp: null, creatorScore: null };
  }

  const lifetimeCount = await getPlayerGamePlayCount(playerKpLedger, playerId, game.id);
  const firstPlay = lifetimeCount === 0;
  const playerKpValue = firstPlay ? POINT_VALUES.playerFirstPlay : POINT_VALUES.playerReplay;
  const creatorScoreValue = firstPlay ? POINT_VALUES.creatorFirstPlay : POINT_VALUES.creatorReplay;
  const playType = firstPlay ? "first_play" : "replay";
  const metadata = { durationSeconds, sessionId, playType };

  const [playerKp, creatorScore] = await Promise.all([
    awardPlayerKp({
      eventId: buildPointEventId("kp-play", [game.id, playerId, sessionId]),
      userId: playerId,
      action: "game_play_qualified",
      kp: playerKpValue,
      targetGameId: game.id,
      sourceUserId: creatorId,
      metadata,
      now,
    }),
    awardCreatorScore({
      eventId: buildPointEventId("cs-play", [game.id, playerId, sessionId]),
      creatorId,
      action: "game_play_qualified",
      cs: creatorScoreValue,
      targetGameId: game.id,
      sourceUserId: playerId,
      metadata,
      now,
    }),
  ]);

  const gamePoints = (playerKp.awarded || creatorScore.awarded)
    ? await updateGamePoints(game.id, { plays: 1, total: creatorScore.cs ?? 0 })
    : null;
  return dualAwardResult({ playerKp, creatorScore, action: "game_play_qualified", pointsForGame: gamePoints });
}

export async function awardLike({ game, actorId }) {
  if (!game?.id || !game?.creatorId || !actorId) return { awarded: false, reason: "missing-input" };
  if (sameUser(game.creatorId, actorId)) return { awarded: false, reason: "self-like" };

  const creatorId = normalizeUserId(game.creatorId);
  const playerId = normalizeUserId(actorId);
  const [playerKp, creatorScore] = await Promise.all([
    awardPlayerKp({
      eventId: buildPointEventId("kp-like", [game.id, playerId]),
      userId: playerId,
      action: "game_like",
      kp: POINT_VALUES.playerLike,
      targetGameId: game.id,
      sourceUserId: creatorId,
    }),
    awardCreatorScore({
      eventId: buildPointEventId("cs-like", [game.id, playerId]),
      creatorId,
      action: "game_like",
      cs: POINT_VALUES.creatorLike,
      targetGameId: game.id,
      sourceUserId: playerId,
    }),
  ]);
  const gamePoints = (playerKp.awarded || creatorScore.awarded)
    ? await updateGamePoints(game.id, { likes: 1, total: POINT_VALUES.creatorLike })
    : null;
  return dualAwardResult({ playerKp, creatorScore, action: "game_like", pointsForGame: gamePoints });
}

export async function awardShare({ game, actorId, platform }) {
  if (!game?.id || !game?.creatorId || !actorId) return { awarded: false, reason: "missing-input" };
  if (sameUser(game.creatorId, actorId)) return { awarded: false, reason: "self-share" };

  const creatorId = normalizeUserId(game.creatorId);
  const playerId = normalizeUserId(actorId);
  const metadata = { platform: platform || "link" };
  const [playerKp, creatorScore] = await Promise.all([
    awardPlayerKp({
      eventId: buildPointEventId("kp-share", [game.id, playerId, platform || "link"]),
      userId: playerId,
      action: "game_share",
      kp: POINT_VALUES.playerShare,
      targetGameId: game.id,
      sourceUserId: creatorId,
      metadata,
    }),
    awardCreatorScore({
      eventId: buildPointEventId("cs-share", [game.id, playerId, platform || "link"]),
      creatorId,
      action: "game_share",
      cs: POINT_VALUES.creatorShare,
      targetGameId: game.id,
      sourceUserId: playerId,
      metadata,
    }),
  ]);
  const gamePoints = (playerKp.awarded || creatorScore.awarded)
    ? await updateGamePoints(game.id, { shares: 1, total: POINT_VALUES.creatorShare })
    : null;
  return dualAwardResult({ playerKp, creatorScore, action: "game_share", pointsForGame: gamePoints });
}

export async function awardFollowCreator({ creatorId, followerId }) {
  if (!creatorId || !followerId) return { awarded: false, reason: "missing-input" };
  if (sameUser(creatorId, followerId)) return { awarded: false, reason: "self-follow" };

  const normalizedCreatorId = normalizeUserId(creatorId);
  const normalizedFollowerId = normalizeUserId(followerId);
  const [playerKp, creatorScore] = await Promise.all([
    awardPlayerKp({
      eventId: buildPointEventId("kp-follow", [normalizedCreatorId, normalizedFollowerId]),
      userId: normalizedFollowerId,
      action: "creator_follow",
      kp: POINT_VALUES.playerFollow,
      sourceUserId: normalizedCreatorId,
    }),
    awardCreatorScore({
      eventId: buildPointEventId("cs-follow", [normalizedCreatorId, normalizedFollowerId]),
      creatorId: normalizedCreatorId,
      action: "creator_follow",
      cs: POINT_VALUES.creatorFollow,
      sourceUserId: normalizedFollowerId,
    }),
  ]);

  return dualAwardResult({ playerKp, creatorScore, action: "creator_follow" });
}

export async function awardFirstGameBonus({ creatorId, gameId }) {
  if (!creatorId || !gameId) return { awarded: false, reason: "missing-input" };
  const normalizedCreatorId = normalizeUserId(creatorId);
  const [playerKp, creatorScore] = await Promise.all([
    awardPlayerKp({
      eventId: buildPointEventId("kp-publish", [gameId, normalizedCreatorId]),
      userId: normalizedCreatorId,
      action: "game_publish",
      kp: POINT_VALUES.playerPublish,
      targetGameId: gameId,
      sourceUserId: normalizedCreatorId,
    }),
    awardCreatorScore({
      eventId: buildPointEventId("cs-publish", [gameId, normalizedCreatorId]),
      creatorId: normalizedCreatorId,
      action: "game_publish",
      cs: POINT_VALUES.creatorPublish,
      targetGameId: gameId,
      sourceUserId: normalizedCreatorId,
    }),
  ]);
  return dualAwardResult({ playerKp, creatorScore, action: "game_publish" });
}

export async function recordCreatorGamePublished({ creatorId, gameId }) {
  if (!creatorId || !gameId) return { recorded: false, reason: "missing-input" };
  const { creators } = await collections();
  const normalizedCreatorId = normalizeUserId(creatorId);
  const now = new Date();
  const existing = await creators.findOne({ creatorId: normalizedCreatorId }, { projection: { _id: 0, publishedGameIds: 1 } });
  if (existing?.publishedGameIds?.includes(gameId)) return { recorded: false, duplicate: true, gameId };

  await creators.updateOne(
    { creatorId: normalizedCreatorId },
    {
      $addToSet: { publishedGameIds: gameId },
      $inc: { gamesCreated: 1 },
      $set: { lastPublishedGameId: gameId, updatedAt: now },
      $setOnInsert: { creatorId: normalizedCreatorId, createdAt: now },
    },
    { upsert: true },
  );
  return { recorded: true, gameId };
}

export async function awardReferralPlay({ referrerId, referredId, attributionId, gameId }) {
  if (!referrerId || !referredId || !attributionId) return { awarded: false, reason: "missing-input" };
  const normalizedReferrerId = normalizeUserId(referrerId);
  const normalizedReferredId = normalizeUserId(referredId);
  if (normalizedReferrerId === normalizedReferredId) return { awarded: false, reason: "self-referral" };

  const [inviterKp, friendKp, inviterScore] = await Promise.all([
    awardPlayerKp({
      eventId: buildPointEventId("kp-invite-inviter", [attributionId, normalizedReferrerId]),
      userId: normalizedReferrerId,
      action: "invite_friend_joined",
      kp: POINT_VALUES.referralInviterKp,
      targetGameId: gameId,
      sourceUserId: normalizedReferredId,
      metadata: { attributionId },
    }),
    awardPlayerKp({
      eventId: buildPointEventId("kp-invite-friend", [attributionId, normalizedReferredId]),
      userId: normalizedReferredId,
      action: "invite_friend_joined",
      kp: POINT_VALUES.referralFriendKp,
      targetGameId: gameId,
      sourceUserId: normalizedReferrerId,
      metadata: { attributionId },
    }),
    awardCreatorScore({
      eventId: buildPointEventId("cs-invite-inviter", [attributionId, normalizedReferrerId]),
      creatorId: normalizedReferrerId,
      action: "invite_friend_joined",
      cs: POINT_VALUES.referralInviterCs,
      targetGameId: gameId,
      sourceUserId: normalizedReferredId,
      metadata: { attributionId },
    }),
  ]);

  return {
    awarded: Boolean(inviterKp.awarded || friendKp.awarded || inviterScore.awarded),
    duplicate: Boolean(inviterKp.duplicate && friendKp.duplicate && inviterScore.duplicate),
    playerKp: inviterKp,
    friendKp,
    creatorScore: inviterScore,
    kp: inviterKp.kp ?? 0,
    cs: inviterScore.cs ?? 0,
    points: inviterKp.kp ?? 0,
  };
}

export async function getPointSummary(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const { browserBalances } = await collections();
  const balance = await browserBalances.findOne({ walletAddress: normalizedUserId }, { projection: { _id: 0 } });
  return {
    userId: normalizedUserId,
    walletAddress: normalizedUserId,
    kultPoints: Number(balance?.kultPoints ?? 0),
    lifetimePoints: Number(balance?.kultPoints ?? 0),
    updatedAt: balance?.updatedAt ?? null,
  };
}

export async function getCreatorScoreSummary(creatorId) {
  const normalizedCreatorId = normalizeUserId(creatorId);
  if (!normalizedCreatorId) return null;
  const { creatorScoreBalances } = await collections();
  return creatorScoreBalances.findOne({ creatorId: normalizedCreatorId }, { projection: { _id: 0 } });
}

export function __setPointsTestHarness(harness) {
  testHarness = harness;
  indexesReady = null;
}
