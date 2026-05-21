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

export function getDatabaseConfig() {
  return {
    configured: Boolean(process.env.MONGODB_URI),
    collection: collectionName
  };
}
