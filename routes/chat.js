import express from "express";
import {
  addMembers,
  clearChatMessages,
  deleteChat,
  forwardMessage,
  getChatDetails,
  getMessages,
  getCallHistory,
  editMessage,
  deleteMessage,
  getMyChats,
  getOrCreateSelfChat,
  getMyGroups,
  leaveGroup,
  newGroupChat,
  removeMember,
  renameGroup,
  sendAttachments,
} from "../controllers/chat.js";
import {
  addMemberValidator,
  chatIdValidator,
  forwardMessageValidator,
  newGroupValidator,
  removeMemberValidator,
  renameValidator,
  sendAttachmentsValidator,
  messageIdParamValidator,
  editMessageValidator,
  deleteMessageQueryValidator,
  validateHandler,
} from "../lib/validators.js";
import { isAuthenticated } from "../middlewares/auth.js";
import { attachmentsMulter } from "../middlewares/multer.js";

const app = express.Router();

// After here user must be logged in to access the routes

app.use(isAuthenticated);

app.post("/new", newGroupValidator(), validateHandler, newGroupChat);

app.get("/my", getMyChats);

app.get("/self", getOrCreateSelfChat);

app.get("/my/groups", getMyGroups);

app.put("/addmembers", addMemberValidator(), validateHandler, addMembers);

app.put(
  "/removemember",
  removeMemberValidator(),
  validateHandler,
  removeMember
);

app.delete("/leave/:id", chatIdValidator(), validateHandler, leaveGroup);

// Send Attachments
app.post(
  "/message",
  attachmentsMulter,
  sendAttachmentsValidator(),
  validateHandler,
  sendAttachments
);

app.patch(
  "/messages/:messageId",
  messageIdParamValidator(),
  editMessageValidator(),
  validateHandler,
  editMessage
);

app.delete(
  "/messages/:messageId",
  messageIdParamValidator(),
  deleteMessageQueryValidator(),
  validateHandler,
  deleteMessage
);

// Get Messages
app.get("/message/:id", chatIdValidator(), validateHandler, getMessages);

app.post(
  "/forward",
  forwardMessageValidator(),
  validateHandler,
  forwardMessage
);

app.post("/:id/clear", chatIdValidator(), validateHandler, clearChatMessages);

app.get("/:id/calls", chatIdValidator(), validateHandler, getCallHistory);

// Get Chat Details, rename,delete
app
  .route("/:id")
  .get(chatIdValidator(), validateHandler, getChatDetails)
  .put(renameValidator(), validateHandler, renameGroup)
  .delete(chatIdValidator(), validateHandler, deleteChat);

export default app;
