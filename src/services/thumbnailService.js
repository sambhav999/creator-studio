import { getDatabase, getGameCollection } from "./databaseService.js";
import { generateImageAsset } from "./zeroGService.js";

const COLLECTION_NAME = "thumbnails";

export async function getThumbnailCollection() {
  const database = await getDatabase();
  return database.collection(COLLECTION_NAME);
}

export async function uploadThumbnail(templateId, buffer, contentType, fileName) {
  const collection = await getThumbnailCollection();
  await collection.updateOne(
    { templateId },
    {
      $set: {
        templateId,
        data: buffer,
        contentType,
        fileName,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  return { templateId, contentType, fileName };
}

export async function getThumbnail(templateId) {
  const collection = await getThumbnailCollection();
  return collection.findOne({ templateId });
}

export async function listThumbnailIds() {
  const collection = await getThumbnailCollection();
  return collection
    .find({}, { projection: { templateId: 1, contentType: 1, fileName: 1, _id: 0 } })
    .toArray();
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Thumbnail download failed with status ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/png"
  };
}

/**
 * Generates a cover image for a freshly generated game (hybrid or pure-agent),
 * downloads it, stores the binary in the thumbnails collection like every
 * other image, and points the saved game record at the served URL.
 * Runs as a background job — never blocks game generation.
 */
export async function generateAndStoreGameThumbnail(game) {
  if (!game?.id) throw new Error("game.id is required for thumbnail generation");

  const prompt = [
    `${game.title} game thumbnail`,
    game.gameplay?.mechanic,
    game.visuals?.mood,
    (game.visuals?.colors ?? []).slice(0, 3).join(" "),
    "polished colorful game cover art, clear gameplay subject, no text"
  ].filter(Boolean).join(", ");

  // Covers don't need full resolution — 512px keeps DB documents ~4x smaller.
  // Not every image model accepts every size, so fall back to the default.
  let result;
  try {
    result = await generateImageAsset({ prompt, size: "512x512" });
  } catch {
    result = await generateImageAsset({ prompt });
  }
  const image = result.images?.[0];

  let buffer;
  let contentType = "image/png";
  if (image?.b64_json) {
    buffer = Buffer.from(image.b64_json, "base64");
  } else if (image?.url) {
    ({ buffer, contentType } = await downloadImage(image.url));
  } else {
    throw new Error("Image agent returned no image");
  }

  await uploadThumbnail(game.id, buffer, contentType, `${game.id}.png`);

  const thumbnailUrl = `/api/thumbnails/${encodeURIComponent(game.id)}`;
  const games = await getGameCollection();
  await games.updateOne(
    { id: game.id },
    { $set: { thumbnailUrl, thumbnailModel: result.model, updatedAt: new Date() } }
  );

  return { gameId: game.id, thumbnailUrl, model: result.model, bytes: buffer.length };
}
