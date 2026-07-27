import { getDatabase, getGameCollection } from "./databaseService.js";
import sharp from "sharp";
import { isSpacesConfigured, uploadPublicObject } from "./spacesStorageService.js";
import { generateImageAsset } from "./zeroGService.js";
import { putBufferOnZeroG } from "./zeroGStorage.js";
import { logActivityOnChain, ACTIVITY } from "./zeroGActivityLog.js";

const COLLECTION_NAME = "thumbnails";
const THUMBNAIL_WIDTH = 384;
const THUMBNAIL_HEIGHT = 576;

export async function getThumbnailCollection() {
  const database = await getDatabase();
  return database.collection(COLLECTION_NAME);
}

export async function uploadThumbnail(templateId, buffer, contentType, fileName) {
  const collection = await getThumbnailCollection();
  const zeroGStorage = await putBufferOnZeroG({
    objectType: "thumbnail",
    objectId: templateId,
    buffer,
    contentType,
    fileName,
    metadata: { templateId }
  });
  // 0G on-chain: an asset-stored event.
  logActivityOnChain(ACTIVITY.ASSET_STORED, templateId);

  // Primary store is DigitalOcean Spaces — Mongo keeps only the public URL.
  if (isSpacesConfigured()) {
    const url = await uploadPublicObject(`thumbnails/${encodeURIComponent(templateId)}`, buffer, contentType);
    await collection.updateOne(
      { templateId },
      {
        $set: { templateId, url, contentType, fileName, zeroGStorage, updatedAt: new Date() },
        $unset: { data: "" },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    return { templateId, contentType, fileName, url };
  }

  // Fallback (Spaces unconfigured): legacy binary storage.
  await collection.updateOne(
    { templateId },
    {
      $set: { templateId, data: buffer, contentType, fileName, zeroGStorage, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return { templateId, contentType, fileName, zeroGStorage };
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
// A short, uppercase cover title (max 3 words) — image models render short
// text far more legibly than long strings, so we trim the game title down.
export function coverTitle(title) {
  const cleaned = String(title || "").replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned.split(" ").slice(0, 3).join(" ") || "GAME").toUpperCase();
}

export async function generateAndStoreGameThumbnail(game) {
  if (!game?.id) throw new Error("game.id is required for thumbnail generation");

  const prompt = [
    `${game.title} game cover art`,
    game.generation?.prompt || game.prompt || game.customization?.prompt,
    game.gameplay?.mechanic,
    game.visuals?.mood,
    (game.visuals?.colors ?? []).slice(0, 3).join(" "),
    `the bold uppercase title "${coverTitle(game.title)}" spelled exactly, in a clean large display font across the top like a game cover`,
    "polished colorful game cover art, clear gameplay subject, crisp legible lettering",
    "vertical 2:3 portrait composition, keep the title and important subjects inside safe margins"
  ].filter(Boolean).join(", ");

  // Request a native 2:3 portrait composition, then normalize the stored file
  // to the exact dimensions used by mobile and tablet game cards.
  let result;
  try {
    result = await generateImageAsset({ prompt, size: "1024x1536" });
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

  buffer = await sharp(buffer)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
      fit: "cover",
      position: "centre"
    })
    .webp({ quality: 88 })
    .toBuffer();
  contentType = "image/webp";

  // Primary store: DigitalOcean Spaces — the public URL goes onto the game
  // record in MongoDB and the frontend renders it directly. Falls back to the
  // Mongo-served thumbnail when Spaces is unavailable.
  const zeroGStorage = await putBufferOnZeroG({
    objectType: "thumbnail",
    objectId: game.id,
    buffer,
    contentType,
    fileName: `${game.id}.webp`,
    metadata: {
      gameId: game.id,
      title: game.title ?? null,
      sourceModel: result.model ?? null,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT
    }
  });
  let thumbnailUrl;
  if (isSpacesConfigured()) {
    try {
      const uploadedUrl = await uploadPublicObject(
        `thumbnails/${encodeURIComponent(game.id)}`,
        buffer,
        contentType
      );
      thumbnailUrl = `${uploadedUrl}?v=${Date.now()}`;
    } catch (error) {
      console.warn("Spaces upload failed; falling back to Mongo thumbnail", { message: error.message });
    }
  }
  if (!thumbnailUrl) {
    await uploadThumbnail(game.id, buffer, contentType, `${game.id}.webp`);
    thumbnailUrl = `/api/thumbnails/${encodeURIComponent(game.id)}`;
  }

  const games = await getGameCollection();
  await games.updateOne(
    { id: game.id },
    {
      $set: {
        thumbnailUrl,
        thumbnailModel: result.model,
        thumbnailWidth: THUMBNAIL_WIDTH,
        thumbnailHeight: THUMBNAIL_HEIGHT,
        thumbnailZeroGStorage: zeroGStorage,
        updatedAt: new Date()
      }
    }
  );

  return {
    gameId: game.id,
    thumbnailUrl,
    model: result.model,
    bytes: buffer.length,
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    zeroGStorage
  };
}
