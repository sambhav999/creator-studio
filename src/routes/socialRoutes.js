import { Router } from "express";
import {
  handleToggleLike,
  handleGetLikeStatus,
  handleAddComment,
  handleGetComments,
  handleDeleteComment,
  handleToggleFavorite,
  handleGetFavoriteStatus,
  handleGetUserFavorites,
  handleRecordShare,
  handleGetShareCount,
  handleGetSocialStats,
  handleGetUserActivities,
  handleGetUserLikes,
  handleRecordView,
  handleGetViewCount,
  handleToggleFollow,
  handleGetFollowStatus,
  handleGetFollowing,
  handleGetCreatorStats,
  handleGetTopViewed,
} from "../controllers/socialController.js";

export const socialRouter = Router();

// Aggregate stats for a game
socialRouter.get("/stats/:gameId", handleGetSocialStats);

// Likes
socialRouter.post("/likes/toggle", handleToggleLike);
socialRouter.get("/likes/:gameId", handleGetLikeStatus);
socialRouter.get("/likes/user/:userId", handleGetUserLikes);

// Comments
socialRouter.post("/comments", handleAddComment);
socialRouter.get("/comments/:gameId", handleGetComments);
socialRouter.delete("/comments/:commentId", handleDeleteComment);

// Favorites
socialRouter.post("/favorites/toggle", handleToggleFavorite);
socialRouter.get("/favorites/:gameId", handleGetFavoriteStatus);
socialRouter.get("/favorites/user/:userId", handleGetUserFavorites);

// Shares
socialRouter.post("/shares", handleRecordShare);
socialRouter.get("/shares/:gameId", handleGetShareCount);

// User activities
socialRouter.get("/activity/user/:userId", handleGetUserActivities);

// Views (plays)
socialRouter.get("/views-top", handleGetTopViewed);
socialRouter.post("/views/:gameId", handleRecordView);
socialRouter.get("/views/:gameId", handleGetViewCount);

// Follows
socialRouter.post("/follows/toggle", handleToggleFollow);
socialRouter.get("/follows/user/:userId", handleGetFollowing);
socialRouter.get("/follows/:creatorId", handleGetFollowStatus);

// Creator profile stats (real numbers)
socialRouter.get("/creator-stats/:creatorId", handleGetCreatorStats);
