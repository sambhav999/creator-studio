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
} from "../controllers/socialController.js";

export const socialRouter = Router();

// Aggregate stats for a game
socialRouter.get("/stats/:gameId", handleGetSocialStats);

// Likes
socialRouter.post("/likes/toggle", handleToggleLike);
socialRouter.get("/likes/:gameId", handleGetLikeStatus);

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
