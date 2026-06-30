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
  browserBalances: "kult_points",
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
  const value = String(userId || "").trim();
  return /^0x/i.test(value) ? value.toLowerCase() : value;
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
  const browserBalances = database.collection(collectionName("browserBalances"));
  const creators = database.collection(collectionName("creators"));
  const players = database.collection(collectionName("players"));

  if (!indexesReady) {
    indexesReady = Promise.allSettled([
      ledger.createIndex({ eventId: 1 }, { unique: true, name: "kp_ledger_eventId_unique" }),
      ledger.createIndex({ userId: 1, createdAt: -1 }, { name: "kp_ledger_user_createdAt" }),
      ledger.createIndex({ source: 1, type: 1, createdAt: -1 }, { name: "kp_ledger_source_type_createdAt" }),
      balances.createIndex({ userId: 1 }, { unique: true, name: "kp_balances_userId_unique" }),
      browserBalances.createIndex({ walletAddress: 1 }, { unique: true, name: "kult_points_walletAddress_unique" }),
      browserBalances.createIndex({ kultPoints: -1 }, { name: "kult_points_score_desc" }),
      creators.createIndex({ creatorId: 1 }, { unique: true, name: "creators_creatorId_unique" }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn("KULT Points index setup skipped", { message: result.reason?.message });
        }
      }
    });
  }
  await indexesReady;

  return { ledger, balances, browserBalances, creators, players };
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
  const normalizedCreatorId = normalizeUserId(creatorId ?? normalizedUserId);
  const normalizedActorId = actorId ? normalizeUserId(actorId) : null;
  if (!normalizedUserId) return { awarded: false, reason: "missing-user" };

  const amount = Number.isFinite(points) ? points : eventAmount(type);
  if (amount <= 0) return { awarded: false, reason: "invalid-points" };

  const { ledger, balances, browserBalances, creators, players } = await collections();
  const event = {
    eventId,
    source: "creator-studio",
    type,
    userId: normalizedUserId,
    points: amount,
    gameId: gameId ?? null,
    creatorId: normalizedCreatorId,
    actorId: normalizedActorId,
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
    browserBalances.updateOne(
      { walletAddress: normalizedUserId },
      {
        $inc: { kultPoints: amount },
        $set: { walletAddress: normalizedUserId, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
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
  await ledger.updateOne(
    { eventId },
    { $set: { browserBalanceSyncedAt: now } },
  );

  if (normalizedCreatorId) {
    await creators.updateOne(
      { creatorId: normalizedCreatorId },
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
  const creatorId = normalizeUserId(game.creatorId);
  const result = await awardKultPoints({
    eventId,
    userId: creatorId,
    type: "game_play_qualified",
    points: POINT_VALUES.qualifiedPlay,
    gameId: game.id,
    creatorId,
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
  const creatorId = normalizeUserId(game.creatorId);
  const result = await awardKultPoints({
    eventId: buildPointEventId("like", [game.id, actorId]),
    userId: creatorId,
    type: "game_like",
    points: POINT_VALUES.like,
    gameId: game.id,
    creatorId,
    actorId,
  });
  if (result.awarded) {
    result.gamePoints = await updateGamePoints(game.id, { likes: 1, total: POINT_VALUES.like });
  }
  return result;
}

export async function awardShare({ game, actorId, platform }) {
  if (!game?.id || !game?.creatorId || !actorId) return { awarded: false, reason: "missing-input" };
  const creatorId = normalizeUserId(game.creatorId);
  const result = await awardKultPoints({
    eventId: buildPointEventId("share", [game.id, actorId, platform || "link"]),
    userId: creatorId,
    type: "game_share",
    points: POINT_VALUES.share,
    gameId: game.id,
    creatorId,
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
  const normalizedCreatorId = normalizeUserId(creatorId);
  return awardKultPoints({
    eventId: buildPointEventId("first-game-bonus", [normalizedCreatorId]),
    userId: normalizedCreatorId,
    type: "creator_first_game_bonus",
    points: POINT_VALUES.firstGameBonus,
    gameId,
    creatorId: normalizedCreatorId,
  });
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
  return awardKultPoints({
    eventId: buildPointEventId("referral-play", [attributionId, normalizedReferrerId]),
    userId: normalizedReferrerId,
    type: "referral_play",
    points: POINT_VALUES.referralPlay,
    gameId,
    creatorId: normalizedReferrerId,
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

export async function syncCreatorKpToBrowserBalances({ dryRun = false, batchSize = 500 } = {}) {
  const { ledger, browserBalances } = await collections();
  const now = new Date();
  let processed = 0;
  let synced = 0;
  let skipped = 0;

  while (true) {
    const events = await ledger
      .find({
        source: "creator-studio",
        browserBalanceSyncedAt: { $exists: false },
        points: { $gt: 0 },
      }, {
        projection: { eventId: 1, userId: 1, points: 1, createdAt: 1 },
        limit: batchSize,
      })
      .toArray();

    if (!events.length) break;

    for (const event of events) {
      processed += 1;
      const walletAddress = normalizeUserId(event.userId);
      const points = Number(event.points);

      if (!walletAddress || !Number.isFinite(points) || points <= 0) {
        skipped += 1;
        if (!dryRun) {
          await ledger.updateOne(
            { _id: event._id },
            { $set: { browserBalanceSyncSkippedAt: now, browserBalanceSyncSkipReason: "invalid-event" } },
          );
        }
        continue;
      }

      if (!dryRun) {
        await browserBalances.updateOne(
          { walletAddress },
          {
            $inc: { kultPoints: points },
            $set: { walletAddress, updatedAt: now },
            $setOnInsert: { createdAt: event.createdAt ?? now },
          },
          { upsert: true },
        );
        await ledger.updateOne(
          { _id: event._id },
          { $set: { browserBalanceSyncedAt: now } },
        );
      }
      synced += 1;
    }

    if (dryRun) break;
  }

  return { dryRun, processed, synced, skipped };
}

export function __setPointsTestHarness(harness) {
  testHarness = harness;
  indexesReady = null;
}
