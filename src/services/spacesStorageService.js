import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// DigitalOcean Spaces (S3-compatible) object storage for game assets.
// Uploaded objects are public-read; their URLs are stored on the game records
// in MongoDB, so the frontend renders them directly from the CDN/bucket.

let client;

function getConfig() {
  const endpoint = process.env.SPACES_ENDPOINT;
  const bucket = process.env.SPACES_BUCKET;
  const key = process.env.SPACES_KEY;
  const secret = process.env.SPACES_SECRET;
  if (!endpoint || !bucket || !key || !secret) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    region: process.env.SPACES_REGION || "us-east-1",
    bucket,
    key,
    secret,
    publicBase: process.env.SPACES_PUBLIC_BASE?.replace(/\/$/, "") || null
  };
}

export function isSpacesConfigured() {
  return Boolean(getConfig());
}

function getClient(config) {
  if (!client) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.key,
        secretAccessKey: config.secret
      }
    });
  }
  return client;
}

/** Public URL for an object key (CDN base when configured, bucket URL otherwise). */
export function publicObjectUrl(objectKey) {
  const config = getConfig();
  if (!config) return null;
  if (config.publicBase) return `${config.publicBase}/${objectKey}`;
  const host = config.endpoint.replace(/^https?:\/\//, "");
  return `https://${config.bucket}.${host}/${objectKey}`;
}

/**
 * Uploads a buffer as a public-read object and returns its public URL.
 * Throws when Spaces is not configured or the upload fails.
 */
export async function uploadPublicObject(objectKey, buffer, contentType) {
  const config = getConfig();
  if (!config) {
    const error = new Error("Spaces storage is not configured (SPACES_* env vars)");
    error.status = 503;
    throw error;
  }

  await getClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable"
    })
  );

  return publicObjectUrl(objectKey);
}
