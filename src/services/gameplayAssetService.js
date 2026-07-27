import { generateImageAsset } from "./zeroGService.js";
import { uploadThumbnail } from "./thumbnailService.js";

function assetId(gameId, role) {
  return `${String(gameId).replace(/[^a-zA-Z0-9_-]/g, "-")}--asset-${role}`;
}

function assetUrl(id) {
  return `/api/thumbnails/${encodeURIComponent(id)}`;
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gameplay asset download failed (${response.status})`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/png"
  };
}

async function generateOne({ id, role, prompt }) {
  let result;
  try {
    result = await generateImageAsset({ prompt, size: "1024x1024" });
  } catch {
    result = await generateImageAsset({ prompt });
  }
  const image = result.images?.[0];
  let buffer;
  let contentType = "image/png";
  if (image?.b64_json) buffer = Buffer.from(image.b64_json, "base64");
  else if (image?.url) ({ buffer, contentType } = await downloadImage(image.url));
  else throw new Error(`Image model returned no ${role} asset`);

  await uploadThumbnail(id, buffer, contentType, `${id}.png`);
  return { id, role, url: assetUrl(id), model: result.model, contentType };
}

export function planGameplayAssets(game) {
  const gameId = game?.id;
  if (!gameId) throw new Error("game.id is required for gameplay assets");
  const title = game.title || "Game";
  const specification = String(
    game.generation?.prompt || game.customization?.prompt || game.gameplay?.mechanic || ""
  ).slice(0, 12000);
  const shared = [
    `Game: ${title}.`,
    specification,
    "Create original production-quality in-game artwork, not cover art.",
    "No logos, captions, title lettering, watermark, frame, mockup, or marketing layout.",
    "Keep a consistent polished visual style suitable for a responsive browser game."
  ].join(" ");

  return [
    {
      role: "player",
      id: assetId(gameId, "player"),
      prompt: `${shared} Main playable character in a clear full-body action pose, centered, readable silhouette, isolated on a plain contrasting background for easy sprite rendering, detailed game-ready character art.`
    },
    {
      role: "environment",
      id: assetId(gameId, "environment"),
      prompt: `${shared} Seamless-feeling gameplay environment background matching the requested world, wide scenic composition, layered depth, no characters, open central play space, game-ready background art.`
    },
    {
      role: "objects",
      id: assetId(gameId, "objects"),
      prompt: `${shared} A clean in-game asset sheet containing the principal obstacles, collectibles, terrain props, and effects requested by the specification, separated with generous spacing on a plain background, consistent scale and lighting.`
    }
  ];
}

export function gameplayAssetManifest(game) {
  return Object.fromEntries(
    planGameplayAssets(game).map(({ role, id }) => [role, assetUrl(id)])
  );
}

export async function generateGameplayAssets(game, onProgress) {
  const plan = planGameplayAssets(game);
  onProgress?.({ stage: "generating-assets", completed: 0, total: plan.length });
  let completed = 0;
  const assets = await Promise.all(
    plan.map(async (item) => {
      const asset = await generateOne(item);
      completed += 1;
      onProgress?.({ stage: "generating-assets", completed, total: plan.length });
      return asset;
    })
  );
  return {
    status: "ready",
    generatedAt: new Date(),
    manifest: Object.fromEntries(assets.map((asset) => [asset.role, asset.url])),
    assets
  };
}
