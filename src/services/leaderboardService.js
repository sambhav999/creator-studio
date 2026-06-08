import { getDatabase } from "./databaseService.js";

const collectionName = "game_leaderboard_scores";
const memoryScores = new Map();

async function getCollection() {
  try {
    const db = await getDatabase();
    return db.collection(collectionName);
  } catch {
    return null;
  }
}

function rankScores(scores, limit) {
  return scores
    .sort((first, second) => {
      if (second.score !== first.score) return second.score - first.score;
      return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
    })
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      gameId: entry.gameId,
      userId: entry.userId,
      username: entry.username,
      score: entry.score,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
}

export async function getLeaderboard(gameId, limit = 50) {
  const collection = await getCollection();

  if (collection) {
    const scores = await collection
      .find({ gameId })
      .sort({ score: -1, createdAt: 1 })
      .limit(limit)
      .toArray();

    return {
      gameId,
      entries: scores.map((entry, index) => ({
        rank: index + 1,
        gameId: entry.gameId,
        userId: entry.userId,
        username: entry.username,
        score: entry.score,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    };
  }

  return {
    gameId,
    entries: rankScores([...(memoryScores.get(gameId) ?? [])], limit),
  };
}

export async function submitScore({ gameId, userId, username, score }) {
  const entry = {
    gameId,
    userId,
    username,
    score,
    updatedAt: new Date(),
  };
  const collection = await getCollection();

  if (collection) {
    await collection.updateOne(
      { gameId, userId },
      {
        $max: { score },
        $set: { username, updatedAt: entry.updatedAt },
        $setOnInsert: { gameId, userId, createdAt: new Date() },
      },
      { upsert: true },
    );
    return getLeaderboard(gameId);
  }

  const scores = memoryScores.get(gameId) ?? [];
  const existing = scores.find((item) => item.userId === userId);
  if (existing) {
    if (score > existing.score) existing.score = score;
    existing.username = username;
    existing.updatedAt = entry.updatedAt;
  } else {
    scores.push({ ...entry, createdAt: new Date() });
  }
  memoryScores.set(gameId, scores);
  return getLeaderboard(gameId);
}
