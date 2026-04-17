import express from "express";
import {
  acceptFriendRequest,
  changePassword,
  forgotPassword,
  getMyFriends,
  getMyNotifications,
  getMyProfile,
  getWebRtcIceConfig,
  login,
  logout,
  newUser,
  resetPassword,
  searchUser,
  sendFriendRequest,
  togglePinChat,
  updateProfile,
} from "../controllers/user.js";
import {
  acceptRequestValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  loginValidator,
  pinChatValidator,
  registerValidator,
  resetPasswordValidator,
  sendRequestValidator,
  updateProfileValidator,
  validateHandler,
} from "../lib/validators.js";
import { isAuthenticated } from "../middlewares/auth.js";
import { singleAvatar } from "../middlewares/multer.js";

const app = express.Router();

app.post("/new", singleAvatar, registerValidator(), validateHandler, newUser);
app.post("/login", loginValidator(), validateHandler, login);

app.post(
  "/forgot-password",
  forgotPasswordValidator(),
  validateHandler,
  forgotPassword
);
app.post(
  "/reset-password",
  resetPasswordValidator(),
  validateHandler,
  resetPassword
);

// After here user must be logged in to access the routes

app.use(isAuthenticated);

app.get("/me", getMyProfile);

app.get("/webrtc-ice", getWebRtcIceConfig);

app.put(
  "/profile",
  singleAvatar,
  updateProfileValidator(),
  validateHandler,
  updateProfile
);

app.put(
  "/password",
  changePasswordValidator(),
  validateHandler,
  changePassword
);

app.get("/logout", logout);

app.get("/search", searchUser);

app.put(
  "/sendrequest",
  sendRequestValidator(),
  validateHandler,
  sendFriendRequest
);

app.put(
  "/acceptrequest",
  acceptRequestValidator(),
  validateHandler,
  acceptFriendRequest
);

app.get("/notifications", getMyNotifications);

app.get("/friends", getMyFriends);

app.put(
  "/pin-chat",
  pinChatValidator(),
  validateHandler,
  togglePinChat
);

export default app;
