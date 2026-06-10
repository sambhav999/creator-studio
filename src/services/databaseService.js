import { MongoClient } from "mongodb";

let client;

const collectionName = process.env.MONGODB_COLLECTION || "prompt_creator_studio";

function getMongoUri() {
  if (!process.env.MONGODB_URI) {
    const error = new Error("MONGODB_URI is not configured");
    error.status = 500;
    throw error;
  }

  return process.env.MONGODB_URI;
}

export async function getDatabase() {
  if (!client) {
    client = new MongoClient(getMongoUri());
    await client.connect();
  }

  return client.db();
}

export async function getGameCollection() {
  const database = await getDatabase();
  return database.collection(collectionName);
}

export async function saveGamePackage(gamePackage) {
  const collection = await getGameCollection();
  await collection.updateOne(
    { id: gamePackage.id },
    {
      $set: {
        ...gamePackage,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  return {
    database: "connected",
    collection: collectionName
  };
}

export async function listGamePackages({ limit = 50, search } = {}) {
  const collection = await getGameCollection();
  // Template auto-saves (every studio selection persists one) are not user
  // creations — only prompt-generated games belong in the creations list.
  const filter = { tier: { $ne: "template" } };
  if (search) {
    filter.$or = [
      { id: search },
      { title: { $regex: search, $options: "i" } },
      { "customization.prompt": { $regex: search, $options: "i" } }
    ];
  }
  return collection
    .find(filter, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
}

// Targeted update: only touches the given fields. Background jobs (code,
// thumbnail) finish at different times — saving a whole stale package from
// one job would clobber what the other already wrote.
export async function updateGamePackageFields(id, fields) {
  const collection = await getGameCollection();
  await collection.updateOne(
    { id },
    { $set: { ...fields, updatedAt: new Date() } }
  );
}

export async function deleteGamePackage(id) {
  const collection = await getGameCollection();
  const result = await collection.deleteOne({ id });
  // Remove the game's generated cover image alongside it.
  const database = await getDatabase();
  await database.collection("thumbnails").deleteOne({ templateId: id });
  return { deleted: result.deletedCount > 0 };
}

export function getDatabaseConfig() {
  return {
    configured: Boolean(process.env.MONGODB_URI),
    collection: collectionName
  };
}
