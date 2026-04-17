import jwt from "jsonwebtoken";
import { TryCatch } from "../middlewares/error.js";
import { Chat } from "../models/chat.js";
import { Message } from "../models/message.js";
import { User } from "../models/user.js";
import { Request } from "../models/request.js";
import { CallLog } from "../models/callLog.js";
import { ErrorHandler } from "../utils/utility.js";
import {
  cookieOptions,
  deletFilesFromCloudinary,
  emitEvent,
} from "../utils/features.js";
import { CHATTU_ADMIN_TOKEN } from "../constants/config.js";
import { adminSecretKey } from "../app.js";
import { REFETCH_CHATS } from "../constants/events.js";

const adminLogin = TryCatch(async (req, res, next) => {
  const { secretKey } = req.body;

  const isMatched = secretKey === adminSecretKey;

  if (!isMatched) return next(new ErrorHandler("Invalid Admin Key", 401));

  const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });
  return res
    .status(200)
    .cookie(CHATTU_ADMIN_TOKEN, token, {
      ...cookieOptions,
      maxAge: 1000 * 60 * 15,
    })
    .json({
      success: true,
      message: "Authenticated Successfully, Welcome BOSS",
    });
});

const adminLogout = TryCatch(async (req, res, next) => {
  return res
    .status(200)
    .cookie(CHATTU_ADMIN_TOKEN, "", {
      ...cookieOptions,
      maxAge: 0,
    })
    .json({
      success: true,
      message: "Logged Out Successfully",
    });
});

const getAdminData = TryCatch(async (req, res, next) => {
  return res.status(200).json({
    admin: true,
  });
});

const allUsers = TryCatch(async (req, res) => {
  const users = await User.find({}).lean();

  const transformedUsers = await Promise.all(
    users.map(async (u) => {
      const { name, username, avatar, _id, email, bio, authProvider, createdAt } =
        u;
      const [groups, friends] = await Promise.all([
        Chat.countDocuments({ groupChat: true, members: _id }),
        Chat.countDocuments({ groupChat: false, members: _id }),
      ]);

      return {
        name,
        username,
        avatar: avatar?.url || "",
        email: email || "",
        bio: bio || "",
        authProvider: authProvider || "local",
        createdAt,
        _id,
        groups,
        friends,
      };
    }),
  );

  return res.status(200).json({
    status: "success",
    users: transformedUsers,
  });
});

const allChats = TryCatch(async (req, res) => {
  const chats = await Chat.find({})
    .populate("members", "name avatar")
    .populate("creator", "name avatar");

  const transformedChats = await Promise.all(
    chats.map(async ({ members, _id, groupChat, name, creator }) => {
      const totalMessages = await Message.countDocuments({ chat: _id });

      return {
        _id,
        groupChat,
        name,
        avatar: members
          .slice(0, 3)
          .map((member) => member.avatar?.url || ""),
        members: members.map(({ _id, name, avatar }) => ({
          _id,
          name,
          avatar: avatar?.url || "",
        })),
        creator: {
          name: creator?.name || "None",
          avatar: creator?.avatar?.url || "",
        },
        totalMembers: members.length,
        totalMessages,
      };
    }),
  );

  return res.status(200).json({
    status: "success",
    chats: transformedChats,
  });
});

const allMessages = TryCatch(async (req, res) => {
  const messages = await Message.find({})
    .populate("sender", "name avatar")
    .populate("chat", "groupChat");

  const transformedMessages = messages.map(
    ({ content, attachments, _id, sender, createdAt, chat }) => ({
      _id,
      attachments,
      content,
      createdAt,
      chat: chat?._id || null,
      groupChat: chat?.groupChat || false,
      sender: {
        _id: sender?._id || null,
        name: sender?.name || "Unknown",
        avatar: sender?.avatar?.url || "",
      },
    }),
  );

  return res.status(200).json({
    success: true,
    messages: transformedMessages,
  });
});

const getDashboardStats = TryCatch(async (req, res) => {
  const [
    groupsCount,
    usersCount,
    messagesCount,
    totalChatsCount,
    localUsersCount,
    googleUsersCount,
    usersWithEmailCount,
  ] = await Promise.all([
    Chat.countDocuments({ groupChat: true }),
    User.countDocuments(),
    Message.countDocuments(),
    Chat.countDocuments(),
    User.countDocuments({ authProvider: "local" }),
    User.countDocuments({ authProvider: "google" }),
    User.countDocuments({
      email: { $exists: true, $nin: [null, ""] },
    }),
  ]);

  const today = new Date();

  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);

  const last7DaysMessages = await Message.find({
    createdAt: {
      $gte: last7Days,
      $lte: today,
    },
  }).select("createdAt");

  const messages = new Array(7).fill(0);
  const dayInMiliseconds = 1000 * 60 * 60 * 24;

  last7DaysMessages.forEach((message) => {
    const indexApprox =
      (today.getTime() - message.createdAt.getTime()) / dayInMiliseconds;
    const index = Math.floor(indexApprox);

    messages[6 - index]++;
  });

  const stats = {
    groupsCount,
    usersCount,
    messagesCount,
    totalChatsCount,
    localUsersCount,
    googleUsersCount,
    usersWithEmailCount,
    messagesChart: messages,
  };

  return res.status(200).json({
    success: true,
    stats,
  });
});

const collectAttachmentPublicIdsForChat = async (chatId) => {
  const messagesWithAttachments = await Message.find({
    chat: chatId,
    attachments: { $exists: true, $ne: [] },
  });
  const public_ids = [];
  messagesWithAttachments.forEach(({ attachments }) =>
    attachments.forEach(({ public_id }) => {
      if (public_id) public_ids.push(public_id);
    })
  );
  return public_ids;
};

const purgeChatById = async (chatId) => {
  const public_ids = await collectAttachmentPublicIdsForChat(chatId);
  await deletFilesFromCloudinary(public_ids);
  await CallLog.deleteMany({ chat: chatId });
  await Message.deleteMany({ chat: chatId });
  await Chat.deleteOne({ _id: chatId });
};

const getPlatformHealth = TryCatch(async (req, res) => {
  return res.status(200).json({
    success: true,
    smtpConfigured: Boolean(
      (
        (process.env.SMTP_USER || process.env.SMTP_MAIL || "").trim() &&
        (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim()
      )
    ),
    clientUrlConfigured: Boolean((process.env.CLIENT_URL || "").trim()),
    jwtSecretConfigured: Boolean((process.env.JWT_SECRET || "").trim()),
  });
});

const adminUpdateUser = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.params.userId);
  if (!user) return next(new ErrorHandler("User not found", 404));

  const { name, bio, username, email } = req.body;

  if (
    name === undefined &&
    bio === undefined &&
    username === undefined &&
    email === undefined
  )
    return next(new ErrorHandler("Nothing to update", 400));

  if (name !== undefined) {
    const t = String(name).trim();
    if (!t) return next(new ErrorHandler("Name cannot be empty", 400));
    user.name = t;
  }
  if (bio !== undefined) user.bio = String(bio).trim();

  if (username !== undefined) {
    const u = String(username).trim();
    if (!u) return next(new ErrorHandler("Username cannot be empty", 400));
    if (u !== user.username) {
      const taken = await User.findOne({
        username: u,
        _id: { $ne: user._id },
      });
      if (taken) return next(new ErrorHandler("Username is already taken", 400));
      user.username = u;
    }
  }

  if (email !== undefined) {
    const e = String(email).trim().toLowerCase();
    if (e) {
      const taken = await User.findOne({ email: e, _id: { $ne: user._id } });
      if (taken) return next(new ErrorHandler("Email is already in use", 400));
      user.email = e;
    } else {
      user.email = undefined;
    }
  }

  await user.save();
  const fresh = await User.findById(user._id).lean();
  return res.status(200).json({
    success: true,
    message: "User updated",
    user: fresh,
  });
});

const adminSetUserPassword = TryCatch(async (req, res, next) => {
  const { newPassword } = req.body;
  const user = await User.findById(req.params.userId).select(
    "+password +passwordResetToken +passwordResetExpires"
  );
  if (!user) return next(new ErrorHandler("User not found", 404));

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password updated for this user",
  });
});

const adminDeleteChat = TryCatch(async (req, res, next) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  const members = chat.members;
  await purgeChatById(chat._id);
  emitEvent(req, REFETCH_CHATS, members);
  return res.status(200).json({ success: true, message: "Chat deleted" });
});

const adminDeleteMessage = TryCatch(async (req, res, next) => {
  const msg = await Message.findById(req.params.messageId);
  if (!msg) return next(new ErrorHandler("Message not found", 404));
  const chat = await Chat.findById(msg.chat).select("members");
  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  const publicIds = (msg.attachments || [])
    .map((a) => a.public_id)
    .filter(Boolean);
  if (publicIds.length) await deletFilesFromCloudinary(publicIds);
  await msg.deleteOne();
  emitEvent(req, REFETCH_CHATS, chat.members);
  return res.status(200).json({ success: true, message: "Message deleted" });
});

const adminDeleteUser = TryCatch(async (req, res, next) => {
  const userId = req.params.userId;
  const user = await User.findById(userId);
  if (!user) return next(new ErrorHandler("User not found", 404));

  await Request.deleteMany({
    $or: [{ sender: userId }, { receiver: userId }],
  });

  const refetchUsers = new Set();
  const chats = await Chat.find({ members: userId });

  for (const chat of chats) {
    chat.members.forEach((m) => refetchUsers.add(m.toString()));

    if (chat.groupChat) {
      const remaining = chat.members.filter(
        (m) => m.toString() !== userId.toString()
      );
      if (remaining.length < 3) {
        await purgeChatById(chat._id);
      } else {
        chat.members = remaining;
        if (chat.creator.toString() === userId.toString()) {
          chat.creator = remaining[0];
        }
        await chat.save();
      }
    } else {
      await purgeChatById(chat._id);
    }
  }

  await Message.deleteMany({ sender: userId });
  await User.deleteOne({ _id: userId });

  emitEvent(req, REFETCH_CHATS, [...refetchUsers]);
  return res.status(200).json({ success: true, message: "User deleted" });
});

export {
  allUsers,
  allChats,
  allMessages,
  getDashboardStats,
  adminLogin,
  adminLogout,
  getAdminData,
  getPlatformHealth,
  adminUpdateUser,
  adminSetUserPassword,
  adminDeleteUser,
  adminDeleteChat,
  adminDeleteMessage,
};
