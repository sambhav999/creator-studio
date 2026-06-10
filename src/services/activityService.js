import { getDatabase } from "./databaseService.js";

const collectionName = "user_activities";
const memoryActivities = [];

async function getCollection() {
  try {
    const db = await getDatabase();
    return db.collection(collectionName);
  } catch {
    return null;
  }
}

export async function logActivity({ userId, gameId, gameTitle, activityType, details }) {
  if (!userId) return;
  const activity = {
    userId,
    gameId: gameId || null,
    gameTitle: gameTitle || null,
    activityType,
    details: details || "",
    timestamp: new Date()
  };

  const col = await getCollection();
  if (col) {
    await col.insertOne(activity);
  } else {
    memoryActivities.unshift(activity);
    if (memoryActivities.length > 100) memoryActivities.pop(); // Cap memory fallback
  }
}

export async function getUserActivities(userId, limit = 50) {
  if (!userId) return [];
  const col = await getCollection();
  if (col) {
    return col.find({ userId }).sort({ timestamp: -1 }).limit(limit).toArray();
  }
  return memoryActivities.filter(a => a.userId === userId).slice(0, limit);
}

export async function getGameTitle(gameId) {
  if (!gameId) return null;
  // If it's a pre-built template
  try {
    const { templates } = await import("../data/templates.js");
    const template = templates.find(t => t.id === gameId);
    if (template) return template.name;
  } catch {
    // silent
  }

  // Otherwise, query MongoDB
  try {
    const db = await getDatabase();
    const game = await db.collection(process.env.MONGODB_COLLECTION || "prompt_creator_studio").findOne({ id: gameId });
    return game?.title || null;
  } catch {
    return null;
  }
}
