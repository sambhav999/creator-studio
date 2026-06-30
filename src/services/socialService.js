import { getDatabase, getGameCollection } from "./databaseService.js";
import { putJsonOnZeroG } from "./zeroGStorage.js";

const COLLECTIONS = {
  likes: "social_likes",
  comments: "social_comments",
  favorites: "social_favorites",
  shares: "social_shares",
  views: "social_views",
  follows: "social_follows",
};

// ─── In-memory fallback when MongoDB is unavailable ────────────────────────
const memoryStore = {
  likes: new Map(),       // gameId → Set<userId>
  comments: new Map(),    // gameId → Array<comment>
  favorites: new Map(),   // gameId → Set<userId>
  shares: new Map(),      // gameId → count
  views: new Map(),       // gameId → count
  follows: new Map(),     // creatorId → Set<followerId>
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
  const [like, comments, favorite, share, view] = await Promise.all([
    getLikeStatus(gameId, userId),
    getComments(gameId, 1, 0), // just count
    getFavoriteStatus(gameId, userId),
    getShareCount(gameId),
    getViewCount(gameId),
  ]);

  return {
    likes: { liked: like.liked, count: like.count },
    comments: { count: comments.count },
    favorites: { favorited: favorite.favorited, count: favorite.count },
    shares: { count: share.count },
    views: { count: view.views },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  VIEWS (plays)
// ═══════════════════════════════════════════════════════════════════════════

export async function recordView(gameId, userId) {
  const col = await getCollection(COLLECTIONS.views);
  let count;
  if (col) {
    await col.updateOne(
      { gameId },
      {
        $inc: { count: 1 },
        $addToSet: { viewers: userId ?? "anon" },
        $setOnInsert: { gameId, createdAt: new Date() },
      },
      { upsert: true },
    );
    const doc = await col.findOne({ gameId });
    count = doc?.count ?? 1;
  } else {
    count = (memoryStore.views.get(gameId) ?? 0) + 1;
    memoryStore.views.set(gameId, count);
  }

  // Mirror onto the game record so list endpoints can show real play counts.
  try {
    const games = await getGameCollection();
    await games.updateOne({ id: gameId }, { $set: { views: count } });
  } catch {
    // game collection unavailable — the views collection still has the truth
  }

  return { gameId, views: count };
}

export async function getViewCount(gameId) {
  const col = await getCollection(COLLECTIONS.views);
  if (col) {
    const doc = await col.findOne({ gameId });
    return { gameId, views: doc?.count ?? 0 };
  }
  return { gameId, views: memoryStore.views.get(gameId) ?? 0 };
}

export async function getTopViewed(limit = 100) {
  const col = await getCollection(COLLECTIONS.views);
  if (col) {
    const docs = await col
      .find({}, { projection: { _id: 0, gameId: 1, count: 1 } })
      .sort({ count: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => ({ gameId: d.gameId, views: d.count ?? 0 }));
  }
  return [...memoryStore.views.entries()]
    .map(([gameId, count]) => ({ gameId, views: count }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
//  FOLLOWS (creator ↔ follower)
// ═══════════════════════════════════════════════════════════════════════════

export async function toggleFollow(creatorId, followerId) {
  const col = await getCollection(COLLECTIONS.follows);
  if (col) {
    const existing = await col.findOne({ creatorId, followerId });
    if (existing) {
      await col.deleteOne({ _id: existing._id });
    } else {
      await col.insertOne({ creatorId, followerId, createdAt: new Date() });
    }
    const followers = await col.countDocuments({ creatorId });
    return { creatorId, following: !existing, followers };
  }

  const set = memoryStore.follows.get(creatorId) ?? new Set();
  const following = !set.has(followerId);
  if (following) set.add(followerId);
  else set.delete(followerId);
  memoryStore.follows.set(creatorId, set);
  return { creatorId, following, followers: set.size };
}

export async function getFollowStatus(creatorId, followerId) {
  const col = await getCollection(COLLECTIONS.follows);
  if (col) {
    const [existing, followers] = await Promise.all([
      followerId ? col.findOne({ creatorId, followerId }) : null,
      col.countDocuments({ creatorId }),
    ]);
    return { creatorId, following: Boolean(existing), followers };
  }
  const set = memoryStore.follows.get(creatorId) ?? new Set();
  return { creatorId, following: followerId ? set.has(followerId) : false, followers: set.size };
}

export async function getFollowingList(followerId) {
  const col = await getCollection(COLLECTIONS.follows);
  if (col) {
    const docs = await col.find({ followerId }).toArray();
    return { followerId, following: docs.map((d) => d.creatorId) };
  }
  const following = [];
  for (const [creatorId, set] of memoryStore.follows) {
    if (set.has(followerId)) following.push(creatorId);
  }
  return { followerId, following };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CREATOR STATS (real profile numbers)
// ═══════════════════════════════════════════════════════════════════════════

export async function getCreatorStats(creatorId) {
  try {
    const games = await getGameCollection();
    const ownGames = await games
      .find({ creatorId, tier: { $ne: "template" } }, { projection: { id: 1, views: 1 } })
      .toArray();
    const gameIds = ownGames.map((g) => g.id);
    const db = await getDatabase();
    const [likes, followers] = await Promise.all([
      gameIds.length ? db.collection(COLLECTIONS.likes).countDocuments({ gameId: { $in: gameIds } }) : 0,
      db.collection(COLLECTIONS.follows).countDocuments({ creatorId }),
    ]);
    const plays = ownGames.reduce((total, g) => total + (g.views ?? 0), 0);
    const profile = { creatorId, games: ownGames.length, plays, likes, followers };
    void putJsonOnZeroG({
      objectType: "profile-snapshot",
      objectId: creatorId,
      data: {
        ...profile,
        snapshottedAt: new Date()
      },
      metadata: { creatorId }
    }).catch((error) => {
      console.warn("0G profile snapshot upload failed", { creatorId, message: error.message });
    });
    return profile;
  } catch {
    return { creatorId, games: 0, plays: 0, likes: 0, followers: 0 };
  }
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
