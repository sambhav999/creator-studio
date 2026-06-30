import test from "node:test";
import assert from "node:assert/strict";
import {
  POINT_VALUES,
  __setPointsTestHarness,
  awardFirstGameBonus,
  awardLike,
  awardQualifiedPlay,
  awardReferralPlay,
  awardShare,
  getPointSummary,
  recordCreatorGamePublished,
} from "../src/services/pointsService.js";

function getByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setByPath(object, path, value) {
  const parts = path.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$ne" in value) {
      const current = getByPath(doc, key);
      return Array.isArray(current) ? !current.includes(value.$ne) : current !== value.$ne;
    }
    return getByPath(doc, key) === value;
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class MemoryCollection {
  constructor(seed = []) {
    this.docs = seed.map(clone);
  }

  async createIndex() {
    return "ok";
  }

  async findOne(filter, options = {}) {
    const doc = this.docs.find((item) => matches(item, filter));
    if (!doc) return null;
    const copy = clone(doc);
    if (options.projection?._id === 0) delete copy._id;
    return copy;
  }

  async updateOne(filter, update, options = {}) {
    let doc = this.docs.find((item) => matches(item, filter));
    let upsertedCount = 0;
    if (!doc && options.upsert) {
      doc = clone(filter);
      this.docs.push(doc);
      upsertedCount = 1;
      for (const [key, value] of Object.entries(update.$setOnInsert ?? {})) {
        setByPath(doc, key, clone(value));
      }
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };

    for (const [key, value] of Object.entries(update.$inc ?? {})) {
      setByPath(doc, key, Number(getByPath(doc, key) ?? 0) + value);
    }
    for (const [key, value] of Object.entries(update.$set ?? {})) {
      setByPath(doc, key, clone(value));
    }
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
      const current = getByPath(doc, key) ?? [];
      if (!current.includes(value)) current.push(value);
      setByPath(doc, key, current);
    }
    return { matchedCount: 1, modifiedCount: 1, upsertedCount };
  }
}

function setupHarness(game = {}) {
  const collections = {
    ledger: new MemoryCollection(),
    balances: new MemoryCollection(),
    browserBalances: new MemoryCollection(),
    creators: new MemoryCollection(),
    players: new MemoryCollection(),
  };
  const gameCollection = new MemoryCollection([
    {
      id: "game-1",
      creatorId: "creator-1",
      points: { plays: 0, likes: 0, shares: 0, total: 0 },
      ...game,
    },
  ]);
  __setPointsTestHarness({ collections, gameCollection });
  return { collections, gameCollection };
}

test("awards likes idempotently to the creator and mirrors game points", async () => {
  const { collections, gameCollection } = setupHarness();
  const game = { id: "game-1", creatorId: "creator-1" };

  const first = await awardLike({ game, actorId: "player-1" });
  const duplicate = await awardLike({ game, actorId: "player-1" });

  assert.equal(first.awarded, true);
  assert.equal(first.points, POINT_VALUES.like);
  assert.equal(duplicate.awarded, false);
  assert.equal(duplicate.duplicate, true);

  assert.equal(collections.ledger.docs.length, 1);
  assert.equal(collections.balances.docs[0].userId, "creator-1");
  assert.equal(collections.balances.docs[0].lifetimePoints, POINT_VALUES.like);
  assert.equal(collections.browserBalances.docs[0].walletAddress, "creator-1");
  assert.equal(collections.browserBalances.docs[0].kultPoints, POINT_VALUES.like);
  assert.equal(collections.players.docs[0].walletAddress, "creator-1");
  assert.equal(collections.players.docs[0].kultPoints, POINT_VALUES.like);

  const storedGame = await gameCollection.findOne({ id: "game-1" });
  assert.deepEqual(storedGame.points, { plays: 0, likes: 1, shares: 0, total: POINT_VALUES.like });
});

test("awards qualified plays only when duration reaches 30 seconds", async () => {
  const { collections, gameCollection } = setupHarness();
  const game = { id: "game-1", creatorId: "creator-1" };

  const short = await awardQualifiedPlay({
    game,
    actorId: "player-1",
    sessionId: "session-short",
    durationSeconds: 29,
  });
  const qualified = await awardQualifiedPlay({
    game,
    actorId: "player-1",
    sessionId: "session-ok",
    durationSeconds: 30,
  });

  assert.equal(short.awarded, false);
  assert.equal(qualified.awarded, true);
  assert.equal(collections.ledger.docs.length, 1);

  const storedGame = await gameCollection.findOne({ id: "game-1" });
  assert.deepEqual(storedGame.points, { plays: 1, likes: 0, shares: 0, total: POINT_VALUES.qualifiedPlay });
});

test("awards shares and first-game bonus without double-paying", async () => {
  const { collections } = setupHarness();
  const game = { id: "game-1", creatorId: "creator-1" };

  await awardShare({ game, actorId: "player-1", platform: "link" });
  await awardShare({ game, actorId: "player-1", platform: "link" });
  const bonus = await awardFirstGameBonus({ creatorId: "creator-1", gameId: "game-1" });
  const duplicateBonus = await awardFirstGameBonus({ creatorId: "creator-1", gameId: "game-2" });

  assert.equal(bonus.awarded, true);
  assert.equal(duplicateBonus.awarded, false);
  assert.equal(collections.ledger.docs.length, 2);

  const summary = await getPointSummary("creator-1");
  assert.equal(summary.lifetimePoints, POINT_VALUES.share + POINT_VALUES.firstGameBonus);
  assert.equal(collections.browserBalances.docs[0].kultPoints, POINT_VALUES.share + POINT_VALUES.firstGameBonus);
});

test("records unique creator published games separately from first-game bonus", async () => {
  const { collections } = setupHarness();

  const firstRecord = await recordCreatorGamePublished({ creatorId: "creator-1", gameId: "game-1" });
  const duplicateRecord = await recordCreatorGamePublished({ creatorId: "creator-1", gameId: "game-1" });
  const secondRecord = await recordCreatorGamePublished({ creatorId: "creator-1", gameId: "game-2" });
  await awardFirstGameBonus({ creatorId: "creator-1", gameId: "game-1" });
  await awardFirstGameBonus({ creatorId: "creator-1", gameId: "game-2" });

  assert.equal(firstRecord.recorded, true);
  assert.equal(duplicateRecord.recorded, false);
  assert.equal(secondRecord.recorded, true);
  assert.equal(collections.creators.docs[0].gamesCreated, 2);
  assert.deepEqual(collections.creators.docs[0].publishedGameIds, ["game-1", "game-2"]);
  assert.equal(collections.ledger.docs.length, 1);
});

test("awards referral play to the referrer using V1 KP value", async () => {
  const { collections } = setupHarness();

  const result = await awardReferralPlay({
    referrerId: "creator-1",
    referredId: "player-2",
    attributionId: "attr-1",
    gameId: "game-1",
  });
  const duplicate = await awardReferralPlay({
    referrerId: "creator-1",
    referredId: "player-2",
    attributionId: "attr-1",
    gameId: "game-1",
  });

  assert.equal(result.awarded, true);
  assert.equal(result.points, POINT_VALUES.referralPlay);
  assert.equal(duplicate.awarded, false);
  assert.equal(collections.ledger.docs.length, 1);
  assert.equal(collections.balances.docs[0].lifetimePoints, POINT_VALUES.referralPlay);
});
