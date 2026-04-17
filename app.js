import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./utils/features.js";
import dotenv from "dotenv";
import { errorMiddleware } from "./middlewares/error.js";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createServer } from "http";
import cors from "cors";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import {
  CHAT_JOINED,
  CHAT_LEAVED,
  MARK_CHAT_READ,
  MESSAGE_DELIVERED,
  MESSAGE_STATUS_UPDATE,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  CALL_CHAT_MESSAGE,
  ONLINE_USERS,
  START_TYPING,
  STOP_TYPING,
} from "./constants/events.js";
import { buildRecipientAcks, getSockets } from "./lib/helper.js";
import { Message } from "./models/message.js";
import { Chat } from "./models/chat.js";
import { corsOptions } from "./constants/config.js";
import { socketAuthenticator } from "./middlewares/auth.js";
import { registerCallHandlers } from "./socket/callHandlers.js";

import userRoute from "./routes/user.js";
import authRoute from "./routes/auth.js";
import chatRoute from "./routes/chat.js";
import adminRoute from "./routes/admin.js";
import aiChatRoute from "./routes/aiChat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

// console.log("Allowed CORS Origins:", process.env.CLIENT_URL);

const mongoURI = process.env.MONGO_URI;
const port = process.env.PORT || 3000;
const envMode = process.env.NODE_ENV.trim() || "PRODUCTION";
const adminSecretKey = process.env.ADMIN_SECRET_KEY || "adsasdsdfsdfsdfd";
const userSocketIDs = new Map();
const onlineUsers = new Set();

connectDB(mongoURI);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

app.set("io", io);

// Using Middlewares Here
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

app.use("/api/v1/auth", authRoute);
app.use("/api/v1/user", userRoute);
app.use("/api/v1/chat", chatRoute);
app.use("/api/v1/admin", adminRoute);
app.use("/api/v1/ai-chat", aiChatRoute);

app.get("/", (req, res) => {
  res.send("Hello World");
});

io.use((socket, next) => {
  cookieParser()(
    socket.request,
    socket.request.res,
    async (err) => await socketAuthenticator(err, socket, next),
  );
});

io.on("connection", (socket) => {
  const user = socket.user;
  userSocketIDs.set(user._id.toString(), socket.id);

  socket.on(NEW_MESSAGE, async ({ chatId, message, replyTo: replyToRaw }) => {
    try {
      const chat = await Chat.findById(chatId).select("members");
      if (!chat) return;

      if (!chat.members.some((m) => m.toString() === user._id.toString()))
        return;

      const recipientAcks = buildRecipientAcks(chat.members, user._id);

      let replyToId;
      if (replyToRaw) {
        const rep = await Message.findById(replyToRaw).select(
          "chat deletedForEveryone"
        );
        if (
          rep &&
          !rep.deletedForEveryone &&
          rep.chat.toString() === String(chatId)
        ) {
          replyToId = rep._id;
        }
      }

      const doc = await Message.create({
        content: message,
        sender: user._id,
        chat: chatId,
        recipientAcks,
        ...(replyToId ? { replyTo: replyToId } : {}),
      });

      const populated = await Message.findById(doc._id)
        .populate("sender", "name")
        .populate({
          path: "replyTo",
          select: "content sender deletedForEveryone",
          populate: { path: "sender", select: "name" },
        })
        .lean();

      const replyToOut = populated.replyTo
        ? {
            _id: populated.replyTo._id,
            content: populated.replyTo.deletedForEveryone
              ? ""
              : populated.replyTo.content || "",
            deletedForEveryone: Boolean(populated.replyTo.deletedForEveryone),
            sender: populated.replyTo.sender
              ? {
                  _id: populated.replyTo.sender._id,
                  name: populated.replyTo.sender.name,
                }
              : null,
          }
        : null;

      const messageForRealTime = {
        _id: populated._id,
        content: populated.content,
        chat: chatId,
        createdAt: populated.createdAt,
        attachments: populated.attachments || [],
        sender: {
          _id: populated.sender._id,
          name: populated.sender.name,
        },
        recipientAcks: populated.recipientAcks || [],
        replyTo: replyToOut,
      };

      const membersSocket = getSockets(chat.members);
      io.to(membersSocket).emit(NEW_MESSAGE, {
        chatId,
        message: messageForRealTime,
      });
      io.to(membersSocket).emit(NEW_MESSAGE_ALERT, { chatId });
    } catch (error) {
      console.error("NEW_MESSAGE socket error:", error);
    }
  });

  socket.on(CALL_CHAT_MESSAGE, async ({ chatId, message: rawText }) => {
    try {
      const text = String(rawText ?? "").trim().slice(0, 2000);
      if (!text) return;

      const chat = await Chat.findById(chatId).select("members");
      if (!chat) return;

      if (!chat.members.some((m) => m.toString() === user._id.toString()))
        return;

      const membersSocket = getSockets(chat.members);
      const payload = {
        chatId,
        message: {
          _id: `call-${Date.now()}-${user._id}`,
          content: text,
          ephemeral: true,
          createdAt: new Date().toISOString(),
          sender: {
            _id: user._id,
            name: user.name,
          },
        },
      };
      io.to(membersSocket).emit(CALL_CHAT_MESSAGE, payload);
    } catch (error) {
      console.error("CALL_CHAT_MESSAGE socket error:", error);
    }
  });

  socket.on(MESSAGE_DELIVERED, async ({ messageId, chatId }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg || msg.chat.toString() !== String(chatId)) return;

      const uid = user._id.toString();
      const idx = msg.recipientAcks.findIndex((r) => {
        const rid = r.user?._id ?? r.user;
        return String(rid) === uid;
      });
      if (idx === -1 || msg.recipientAcks[idx].deliveredAt) return;

      msg.recipientAcks[idx].deliveredAt = new Date();
      msg.markModified("recipientAcks");
      await msg.save();

      const chat = await Chat.findById(chatId).select("members");
      if (!chat) return;

      const plain = msg.toObject
        ? msg.toObject({ flattenMaps: true })
        : { _id: msg._id, recipientAcks: msg.recipientAcks };

      const membersSocket = getSockets(chat.members);
      io.to(membersSocket).emit(MESSAGE_STATUS_UPDATE, {
        chatId,
        updates: [
          {
            messageId: String(plain._id),
            recipientAcks: plain.recipientAcks || [],
          },
        ],
      });
    } catch (error) {
      console.error("MESSAGE_DELIVERED socket error:", error);
    }
  });

  socket.on(MARK_CHAT_READ, async ({ chatId }) => {
    try {
      const chat = await Chat.findById(chatId).select("members");
      if (!chat) return;

      if (!chat.members.some((m) => m.toString() === user._id.toString()))
        return;

      const userObj = new mongoose.Types.ObjectId(user._id.toString());
      const now = new Date();

      const filter = {
        chat: chatId,
        sender: { $ne: userObj },
        recipientAcks: {
          $elemMatch: {
            user: userObj,
            $or: [{ readAt: { $exists: false } }, { readAt: null }],
          },
        },
      };

      const ids = await Message.distinct("_id", filter);
      if (!ids.length) return;

      await Message.updateMany(
        { _id: { $in: ids } },
        { $set: { "recipientAcks.$[elem].readAt": now } },
        { arrayFilters: [{ "elem.user": userObj }] },
      );

      const refreshed = await Message.find({ _id: { $in: ids } })
        .select("recipientAcks")
        .lean();

      const updates = refreshed.map((m) => ({
        messageId: String(m._id),
        recipientAcks: m.recipientAcks || [],
      }));

      const membersSocket = getSockets(chat.members);
      io.to(membersSocket).emit(MESSAGE_STATUS_UPDATE, {
        chatId,
        updates,
      });
    } catch (error) {
      console.error("MARK_CHAT_READ socket error:", error);
    }
  });

  socket.on(START_TYPING, ({ members, chatId }) => {
    const membersSockets = getSockets(members);
    socket.to(membersSockets).emit(START_TYPING, { chatId });
  });

  socket.on(STOP_TYPING, ({ members, chatId }) => {
    const membersSockets = getSockets(members);
    socket.to(membersSockets).emit(STOP_TYPING, { chatId });
  });

  socket.on(CHAT_JOINED, ({ userId, members }) => {
    onlineUsers.add(userId.toString());

    const membersSocket = getSockets(members);
    io.to(membersSocket).emit(ONLINE_USERS, Array.from(onlineUsers));
  });

  socket.on(CHAT_LEAVED, ({ userId, members }) => {
    onlineUsers.delete(userId.toString());

    const membersSocket = getSockets(members);
    io.to(membersSocket).emit(ONLINE_USERS, Array.from(onlineUsers));
  });

  registerCallHandlers(io, socket, user, {
    getUserSocketId: (uid) => userSocketIDs.get(String(uid)),
  });

  socket.on("disconnect", () => {
    userSocketIDs.delete(user._id.toString());
    onlineUsers.delete(user._id.toString());
    socket.broadcast.emit(ONLINE_USERS, Array.from(onlineUsers));
  });
});

app.use(errorMiddleware);

server.listen(port, () => {
  console.log(`Server is running on port ${port} in ${envMode} Mode`);
});

export { envMode, adminSecretKey, userSocketIDs };
