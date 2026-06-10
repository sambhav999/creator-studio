import { getDatabase } from "./databaseService.js";

const COLLECTIONS = {
  likes: "social_likes",
  comments: "social_comments",
  favorites: "social_favorites",
  shares: "social_shares",
};

// ─── In-memory fallback when MongoDB is unavailable ────────────────────────
const memoryStore = {
  likes: new Map(),       // gameId → Set<userId>
  comments: new Map(),    // gameId → Array<comment>
  favorites: new Map(),   // gameId → Set<userId>
  shares: new Map(),      // gameId → count
};

async function getCollection(name) {
  try {
    const db = await getDatabase();
    return db.collection(name);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIKES
// ═══════════════════════════════════════════════════════════════════════════

export async function toggleLike(gameId, userId) {
  const col = await getCollection(COLLECTIONS.likes);

  if (col) {
    const existing = await col.findOne({ gameId, userId });
    if (existing) {
      await col.deleteOne({ _id: existing._id });
      const count = await col.countDocuments({ gameId });
      return { liked: false, count };
    }
    await col.insertOne({ gameId, userId, createdAt: new Date() });
    const count = await col.countDocuments({ gameId });
    return { liked: true, count };
  }

  // fallback
  if (!memoryStore.likes.has(gameId)) memoryStore.likes.set(gameId, new Set());
  const set = memoryStore.likes.get(gameId);
  const wasLiked = set.has(userId);
  wasLiked ? set.delete(userId) : set.add(userId);
  return { liked: !wasLiked, count: set.size };
}

export async function getLikeStatus(gameId, userId) {
  const col = await getCollection(COLLECTIONS.likes);

  if (col) {
    const existing = userId ? await col.findOne({ gameId, userId }) : null;
    const count = await col.countDocuments({ gameId });
    return { liked: Boolean(existing), count };
  }

  const set = memoryStore.likes.get(gameId) ?? new Set();
  return { liked: userId ? set.has(userId) : false, count: set.size };
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMMENTS
// ═══════════════════════════════════════════════════════════════════════════

export async function addComment(gameId, userId, username, text) {
  const comment = {
    gameId,
    userId,
    username,
    text,
    createdAt: new Date(),
  };

  const col = await getCollection(COLLECTIONS.comments);

  if (col) {
    const result = await col.insertOne(comment);
    comment._id = result.insertedId;
    const count = await col.countDocuments({ gameId });
    return { comment, count };
  }

  // fallback
  if (!memoryStore.comments.has(gameId)) memoryStore.comments.set(gameId, []);
  const arr = memoryStore.comments.get(gameId);
  comment._id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  arr.push(comment);
  return { comment, count: arr.length };
}

export async function getComments(gameId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const col = await getCollection(COLLECTIONS.comments);

  if (col) {
    const [comments, count] = await Promise.all([
      col.find({ gameId }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments({ gameId }),
    ]);
    return { comments, count, page, limit, totalPages: Math.ceil(count / limit) };
  }

  const arr = memoryStore.comments.get(gameId) ?? [];
  const sorted = [...arr].reverse();
  return {
    comments: sorted.slice(skip, skip + limit),
    count: arr.length,
    page,
    limit,
    totalPages: Math.ceil(arr.length / limit),
  };
}

export async function deleteComment(commentId, userId) {
  const col = await getCollection(COLLECTIONS.comments);

  if (col) {
    const { ObjectId } = await import("mongodb");
    let filter;
    try {
      filter = { _id: new ObjectId(commentId), userId };
    } catch {
      filter = { _id: commentId, userId };
    }
    const result = await col.deleteOne(filter);
    return { deleted: result.deletedCount > 0 };
  }

  for (const [, arr] of memoryStore.comments) {
    const idx = arr.findIndex((c) => c._id === commentId && c.userId === userId);
    if (idx !== -1) {
      arr.splice(idx, 1);
      return { deleted: true };
    }
  }
  return { deleted: false };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FAVORITES (Bookmark)
// ═══════════════════════════════════════════════════════════════════════════

export async function toggleFavorite(gameId, userId) {
  const col = await getCollection(COLLECTIONS.favorites);

  if (col) {
    const existing = await col.findOne({ gameId, userId });
    if (existing) {
      await col.deleteOne({ _id: existing._id });
      const count = await col.countDocuments({ gameId });
      return { favorited: false, count };
    }
    await col.insertOne({ gameId, userId, createdAt: new Date() });
    const count = await col.countDocuments({ gameId });
    return { favorited: true, count };
  }

  if (!memoryStore.favorites.has(gameId)) memoryStore.favorites.set(gameId, new Set());
  const set = memoryStore.favorites.get(gameId);
  const was = set.has(userId);
  was ? set.delete(userId) : set.add(userId);
  return { favorited: !was, count: set.size };
}

export async function getFavoriteStatus(gameId, userId) {
  const col = await getCollection(COLLECTIONS.favorites);

  if (col) {
    const existing = userId ? await col.findOne({ gameId, userId }) : null;
    const count = await col.countDocuments({ gameId });
    return { favorited: Boolean(existing), count };
  }

  const set = memoryStore.favorites.get(gameId) ?? new Set();
  return { favorited: userId ? set.has(userId) : false, count: set.size };
}

export async function getUserFavorites(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const col = await getCollection(COLLECTIONS.favorites);

  if (col) {
    const [favorites, count] = await Promise.all([
      col.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments({ userId }),
    ]);
    return { favorites, count, page, limit };
  }

  const results = [];
  for (const [gameId, set] of memoryStore.favorites) {
    if (set.has(userId)) results.push({ gameId, userId });
  }
  return { favorites: results.slice(skip, skip + limit), count: results.length, page, limit };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARES
// ═══════════════════════════════════════════════════════════════════════════

export async function recordShare(gameId, userId, platform) {
  const share = {
    gameId,
    userId,
    platform: platform ?? "link",
    createdAt: new Date(),
  };

  const col = await getCollection(COLLECTIONS.shares);

  if (col) {
    await col.insertOne(share);
    const count = await col.countDocuments({ gameId });
    return { shared: true, count };
  }

  memoryStore.shares.set(gameId, (memoryStore.shares.get(gameId) ?? 0) + 1);
  return { shared: true, count: memoryStore.shares.get(gameId) };
}

export async function getShareCount(gameId) {
  const col = await getCollection(COLLECTIONS.shares);

  if (col) {
    const count = await col.countDocuments({ gameId });
    return { count };
  }

  return { count: memoryStore.shares.get(gameId) ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AGGREGATE — all social stats for a game at once
// ═══════════════════════════════════════════════════════════════════════════

export async function getSocialStats(gameId, userId) {
  const [like, comments, favorite, share] = await Promise.all([
    getLikeStatus(gameId, userId),
    getComments(gameId, 1, 0), // just count
    getFavoriteStatus(gameId, userId),
    getShareCount(gameId),
  ]);

  return {
    likes: { liked: like.liked, count: like.count },
    comments: { count: comments.count },
    favorites: { favorited: favorite.favorited, count: favorite.count },
    shares: { count: share.count },
  };
}

export async function getUserLikes(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const col = await getCollection(COLLECTIONS.likes);

  if (col) {
    const [likes, count] = await Promise.all([
      col.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments({ userId }),
    ]);
    return { likes, count, page, limit };
  }

  const results = [];
  for (const [gameId, set] of memoryStore.likes) {
    if (set.has(userId)) results.push({ gameId, userId });
  }
  return { likes: results.slice(skip, skip + limit), count: results.length, page, limit };
}
