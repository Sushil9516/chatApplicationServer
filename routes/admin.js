import express from "express";
import {
  adminLogin,
  adminLogout,
  adminDeleteChat,
  adminDeleteMessage,
  adminDeleteUser,
  adminSetUserPassword,
  adminUpdateUser,
  allChats,
  allMessages,
  allUsers,
  getAdminData,
  getDashboardStats,
  getPlatformHealth,
} from "../controllers/admin.js";
import {
  adminLoginValidator,
  adminUserIdParam,
  adminChatIdParam,
  adminMessageIdParam,
  adminUpdateUserValidator,
  adminSetUserPasswordValidator,
  validateHandler,
} from "../lib/validators.js";
import { adminOnly } from "../middlewares/auth.js";

const app = express.Router();

app.post("/verify", adminLoginValidator(), validateHandler, adminLogin);

app.get("/logout", adminLogout);

app.use(adminOnly);

app.get("/", getAdminData);

app.get("/platform", getPlatformHealth);

app.get("/users", allUsers);
app.patch(
  "/users/:userId",
  adminUpdateUserValidator(),
  validateHandler,
  adminUpdateUser
);
app.post(
  "/users/:userId/password",
  adminSetUserPasswordValidator(),
  validateHandler,
  adminSetUserPassword
);
app.delete(
  "/users/:userId",
  adminUserIdParam(),
  validateHandler,
  adminDeleteUser
);

app.get("/chats", allChats);
app.delete(
  "/chats/:chatId",
  adminChatIdParam(),
  validateHandler,
  adminDeleteChat
);

app.get("/messages", allMessages);
app.delete(
  "/messages/:messageId",
  adminMessageIdParam(),
  validateHandler,
  adminDeleteMessage
);

app.get("/stats", getDashboardStats);

export default app;
