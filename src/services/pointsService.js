import { getDatabaseByName, getGameCollection } from "./databaseService.js";

export const POINT_VALUES = Object.freeze({
  qualifiedPlay: 1,
  like: 3,
  share: 10,
  referralPlay: 5,
  firstGameBonus: 250,
});

const DEFAULT_COLLECTIONS = Object.freeze({
  ledger: "kp_ledger",
  balances: "kp_balances",
  creators: "creators",
  players: "store_players",
});
const DEFAULT_POINTS_DB = "kult_browser";

let indexesReady;
let testHarness = null;

function collectionName(key) {
  const envKey = `KULT_POINTS_${key.toUpperCase()}_COLLECTION`;
  return process.env[envKey] || DEFAULT_COLLECTIONS[key];
}

function pointsDatabaseName() {
  return process.env.KULT_POINTS_DB || process.env.KULT_BROWSER_DB || DEFAULT_POINTS_DB;
}

function normalizeUserId(userId) {
  return String(userId || "").trim();
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

function eventAmount(type) {
  switch (type) {
    case "game_play_qualified":
      return POINT_VALUES.qualifiedPlay;
    case "game_like":
      return POINT_VALUES.like;
    case "game_share":
      return POINT_VALUES.share;
    case "referral_play":
      return POINT_VALUES.referralPlay;
    case "creator_first_game_bonus":
      return POINT_VALUES.firstGameBonus;
    default:
      return 0;
  }
}

function periodUpdates(amount, now) {
  const day = dayKey(now);
  const week = weekKey(now);
  return {
    $inc: {
      lifetimePoints: amount,
      [`dailyPoints.${day}`]: amount,
      [`weeklyPoints.${week}`]: amount,
    },
    $set: {
      currentDay: day,
      currentWeek: week,
      updatedAt: now,
    },
    $setOnInsert: {
      createdAt: now,
    },
  };
}

async function collections() {
  if (testHarness?.collections) return testHarness.collections;

  const database = await getDatabaseByName(pointsDatabaseName());
  const ledger = database.collection(collectionName("ledger"));
  const balances = database.collection(collectionName("balances"));
  const creators = database.collection(collectionName("creators"));
  const players = database.collection(collectionName("players"));

  if (!indexesReady) {
    indexesReady = Promise.all([
      ledger.createIndex({ eventId: 1 }, { unique: true }),
      ledger.createIndex({ userId: 1, createdAt: -1 }),
      ledger.createIndex({ source: 1, type: 1, createdAt: -1 }),
      balances.createIndex({ userId: 1 }, { unique: true }),
      creators.createIndex({ creatorId: 1 }, { unique: true }),
      players.createIndex({ walletAddress: 1 }, { unique: true, sparse: true }),
    ]);
  }
  await indexesReady;

  return { ledger, balances, creators, players };
}

export function buildPointEventId(type, parts) {
  return ["creator-studio", type, ...parts.map((part) => String(part ?? "none"))].join(":");
}

export async function awardKultPoints({
  eventId,
  userId,
  type,
  points,
  gameId,
  creatorId,
  actorId,
  metadata = {},
  now = new Date(),
}) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return { awarded: false, reason: "missing-user" };

  const amount = Number.isFinite(points) ? points : eventAmount(type);
  if (amount <= 0) return { awarded: false, reason: "invalid-points" };

  const { ledger, balances, creators, players } = await collections();
  const event = {
    eventId,
    source: "creator-studio",
    type,
    userId: normalizedUserId,
    points: amount,
    gameId: gameId ?? null,
    creatorId: creatorId ?? normalizedUserId,
    actorId: actorId ?? null,
    metadata,
    createdAt: now,
  };

  const insertResult = await ledger.updateOne(
    { eventId },
    { $setOnInsert: event },
    { upsert: true },
  );
  const awarded = Boolean(insertResult.upsertedCount);
  if (!awarded) {
    const balance = await balances.findOne({ userId: normalizedUserId }, { projection: { _id: 0 } });
    return { awarded: false, duplicate: true, points: 0, balance };
  }

  await Promise.all([
    balances.updateOne(
      { userId: normalizedUserId },
      periodUpdates(amount, now),
      { upsert: true },
    ),
    // KULT Browser identifies players by walletAddress in the copied backend.
    // Updating this collection lets Creator Studio awards show up for Browser
    // users when both apps share the MongoDB server.
    players.updateOne(
      { walletAddress: normalizedUserId },
      {
        $inc: { kultPoints: amount, lifetimeKultPoints: amount },
        $set: { updatedAt: now },
        $setOnInsert: { walletAddress: normalizedUserId, createdAt: now },
      },
      { upsert: true },
    ),
  ]);

  if (creatorId) {
    await creators.updateOne(
      { creatorId },
      periodUpdates(amount, now),
      { upsert: true },
    );
  }

  const balance = await balances.findOne({ userId: normalizedUserId }, { projection: { _id: 0 } });
  return { awarded: true, points: amount, balance };
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

export async function awardQualifiedPlay({ game, actorId, sessionId, durationSeconds }) {
  if (!game?.id || !game?.creatorId || Number(durationSeconds) < 30) {
    return { awarded: false, reason: "not-qualified" };
  }
  const eventId = buildPointEventId("play", [game.id, actorId, sessionId]);
  const result = await awardKultPoints({
    eventId,
    userId: game.creatorId,
    type: "game_play_qualified",
    points: POINT_VALUES.qualifiedPlay,
    gameId: game.id,
    creatorId: game.creatorId,
    actorId,
    metadata: { durationSeconds, sessionId },
  });
  if (result.awarded) {
    result.gamePoints = await updateGamePoints(game.id, { plays: 1, total: POINT_VALUES.qualifiedPlay });
  }
  return result;
}

export async function awardLike({ game, actorId }) {
  if (!game?.id || !game?.creatorId || !actorId) return { awarded: false, reason: "missing-input" };
  const result = await awardKultPoints({
    eventId: buildPointEventId("like", [game.id, actorId]),
    userId: game.creatorId,
    type: "game_like",
    points: POINT_VALUES.like,
    gameId: game.id,
    creatorId: game.creatorId,
    actorId,
  });
  if (result.awarded) {
    result.gamePoints = await updateGamePoints(game.id, { likes: 1, total: POINT_VALUES.like });
  }
  return result;
}

export async function awardShare({ game, actorId, platform }) {
  if (!game?.id || !game?.creatorId || !actorId) return { awarded: false, reason: "missing-input" };
  const result = await awardKultPoints({
    eventId: buildPointEventId("share", [game.id, actorId, platform || "link"]),
    userId: game.creatorId,
    type: "game_share",
    points: POINT_VALUES.share,
    gameId: game.id,
    creatorId: game.creatorId,
    actorId,
    metadata: { platform: platform || "link" },
  });
  if (result.awarded) {
    result.gamePoints = await updateGamePoints(game.id, { shares: 1, total: POINT_VALUES.share });
  }
  return result;
}

export async function awardFirstGameBonus({ creatorId, gameId }) {
  if (!creatorId || !gameId) return { awarded: false, reason: "missing-input" };
  return awardKultPoints({
    eventId: buildPointEventId("first-game-bonus", [creatorId]),
    userId: creatorId,
    type: "creator_first_game_bonus",
    points: POINT_VALUES.firstGameBonus,
    gameId,
    creatorId,
  });
}

export async function recordCreatorGamePublished({ creatorId, gameId }) {
  if (!creatorId || !gameId) return { recorded: false, reason: "missing-input" };
  const { creators } = await collections();
  const now = new Date();
  const existing = await creators.findOne({ creatorId }, { projection: { _id: 0, publishedGameIds: 1 } });
  if (existing?.publishedGameIds?.includes(gameId)) return { recorded: false, duplicate: true, gameId };

  await creators.updateOne(
    { creatorId },
    {
      $addToSet: { publishedGameIds: gameId },
      $inc: { gamesCreated: 1 },
      $set: { lastPublishedGameId: gameId, updatedAt: now },
      $setOnInsert: { creatorId, createdAt: now },
    },
    { upsert: true },
  );
  return { recorded: true, gameId };
}

export async function awardReferralPlay({ referrerId, referredId, attributionId, gameId }) {
  if (!referrerId || !referredId || !attributionId) return { awarded: false, reason: "missing-input" };
  return awardKultPoints({
    eventId: buildPointEventId("referral-play", [attributionId, referrerId]),
    userId: referrerId,
    type: "referral_play",
    points: POINT_VALUES.referralPlay,
    gameId,
    creatorId: referrerId,
    actorId: referredId,
    metadata: { attributionId },
  });
}

export async function getPointSummary(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const { balances } = await collections();
  return balances.findOne({ userId: normalizedUserId }, { projection: { _id: 0 } });
}

export function __setPointsTestHarness(harness) {
  testHarness = harness;
  indexesReady = null;
}
