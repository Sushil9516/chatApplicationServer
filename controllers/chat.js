import mongoose from "mongoose";
import { TryCatch } from "../middlewares/error.js";
import { ErrorHandler } from "../utils/utility.js";
import { Chat } from "../models/chat.js";
import {
  deletFilesFromCloudinary,
  emitEvent,
  uploadFilesToCloudinary,
} from "../utils/features.js";
import {
  ALERT,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  REFETCH_CHATS,
  MESSAGE_EDITED,
  MESSAGE_DELETED_EVERYONE,
  MESSAGE_HIDDEN_FOR_USER,
} from "../constants/events.js";
import {
  buildRecipientAcks,
  getOtherMember,
  isChatMember,
} from "../lib/helper.js";
import { User } from "../models/user.js";
import { Message } from "../models/message.js";
import { CallLog } from "../models/callLog.js";

const newGroupChat = TryCatch(async (req, res, next) => {
  const { name, members } = req.body;

  const memberIds = [...members, req.user].map((id) =>
    typeof id === "string" ? new mongoose.Types.ObjectId(id) : id
  );

  await Chat.create({
    name,
    groupChat: true,
    creator: req.user,
    members: memberIds,
  });

  emitEvent(req, ALERT, memberIds, `Welcome to ${name} group`);
  emitEvent(req, REFETCH_CHATS, members);

  return res.status(201).json({
    success: true,
    message: "Group Created",
  });
});

const getMyChats = TryCatch(async (req, res, next) => {
  const chats = await Chat.find({ members: req.user }).populate(
    "members",
    "name avatar"
  );

  const userId = new mongoose.Types.ObjectId(req.user);
  const chatIds = chats.map((c) => c._id);
  const lastByChatId = new Map();

  if (chatIds.length) {
    const grouped = await Message.aggregate([
      {
        $match: {
          chat: { $in: chatIds },
          hiddenForUsers: { $nin: [userId] },
        },
      },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$chat", doc: { $first: "$$ROOT" } } },
    ]);

    const senderIds = grouped
      .map((g) => g.doc?.sender)
      .filter(Boolean);
    const senders =
      senderIds.length > 0
        ? await User.find({ _id: { $in: senderIds } })
            .select("name")
            .lean()
        : [];
    const senderMap = new Map(senders.map((s) => [String(s._id), s.name]));

    for (const g of grouped) {
      const d = g.doc;
      if (!d) continue;
      lastByChatId.set(String(g._id), {
        content: d.content || "",
        createdAt: d.createdAt,
        senderId: d.sender ? String(d.sender) : "",
        senderName: senderMap.get(String(d.sender)) || "",
        attachmentsCount: Array.isArray(d.attachments) ? d.attachments.length : 0,
        deletedForEveryone: Boolean(d.deletedForEveryone),
      });
    }
  }

  const selfScore = (c) =>
    !c.groupChat && c.members.length === 1 ? 0 : 1;

  chats.sort((a, b) => {
    const sa = selfScore(a);
    const sb = selfScore(b);
    if (sa !== sb) return sa - sb;
    const ta = new Date(
      lastByChatId.get(String(a._id))?.createdAt || a.updatedAt
    ).getTime();
    const tb = new Date(
      lastByChatId.get(String(b._id))?.createdAt || b.updatedAt
    ).getTime();
    return tb - ta;
  });

  const transformedChats = chats.map(({ _id, name, members, groupChat, updatedAt }) => {
    const lastMessage = lastByChatId.get(String(_id)) || null;

    if (groupChat) {
      return {
        _id,
        groupChat,
        avatar: members.slice(0, 3).map(({ avatar }) => avatar.url),
        name,
        updatedAt,
        lastMessage,
        members: members.reduce((prev, curr) => {
          if (curr._id.toString() !== req.user.toString()) {
            prev.push(curr._id);
          }
          return prev;
        }, []),
      };
    }

    if (members.length === 1) {
      const only = members[0];
      return {
        _id,
        groupChat: false,
        avatar: [only.avatar.url],
        name: "Saved messages",
        updatedAt,
        lastMessage,
        members: [],
      };
    }

    const otherMember = getOtherMember(members, req.user);

    return {
      _id,
      groupChat: false,
      avatar: [otherMember.avatar.url],
      name: otherMember.name,
      updatedAt,
      lastMessage,
      members: members.reduce((prev, curr) => {
        if (curr._id.toString() !== req.user.toString()) {
          prev.push(curr._id);
        }
        return prev;
      }, []),
    };
  });

  return res.status(200).json({
    success: true,
    chats: transformedChats,
  });
});

const getOrCreateSelfChat = TryCatch(async (req, res, next) => {
  const existing = await Chat.findOne({
    groupChat: false,
    members: req.user,
    $expr: { $eq: [{ $size: "$members" }, 1] },
  });

  if (existing) {
    return res.status(200).json({
      success: true,
      chat: existing,
    });
  }

  const chat = await Chat.create({
    name: "Saved messages",
    groupChat: false,
    creator: req.user,
    members: [req.user],
  });

  return res.status(201).json({
    success: true,
    chat,
  });
});

const getMyGroups = TryCatch(async (req, res, next) => {
  /** All group chats the user belongs to (not only groups they created). */
  const chats = await Chat.find({
    members: req.user,
    groupChat: true,
  }).populate("members", "name avatar");

  const groups = chats.map(({ members, _id, groupChat, name }) => ({
    _id,
    groupChat,
    name,
    avatar: members.slice(0, 3).map(({ avatar }) => avatar.url),
  }));

  return res.status(200).json({
    success: true,
    groups,
  });
});

const addMembers = TryCatch(async (req, res, next) => {
  const { chatId, members } = req.body;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(new ErrorHandler("You are not allowed to add members", 403));

  const allNewMembersPromise = members.map((i) => User.findById(i, "name"));

  const allNewMembers = await Promise.all(allNewMembersPromise);

  const uniqueMembers = allNewMembers
    .filter((i) => !chat.members.includes(i._id.toString()))
    .map((i) => i._id);

  chat.members.push(...uniqueMembers);

  if (chat.members.length > 100)
    return next(new ErrorHandler("Group members limit reached", 400));

  await chat.save();

  const allUsersName = allNewMembers.map((i) => i.name).join(", ");

  emitEvent(
    req,
    ALERT,
    chat.members,
    `${allUsersName} has been added in the group`
  );

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Members added successfully",
  });
});

const removeMember = TryCatch(async (req, res, next) => {
  const { userId, chatId } = req.body;

  const [chat, userThatWillBeRemoved] = await Promise.all([
    Chat.findById(chatId),
    User.findById(userId, "name"),
  ]);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(new ErrorHandler("You are not allowed to add members", 403));

  if (chat.members.length <= 3)
    return next(new ErrorHandler("Group must have at least 3 members", 400));

  const allChatMembers = chat.members.map((i) => i.toString());

  chat.members = chat.members.filter(
    (member) => member.toString() !== userId.toString()
  );

  await chat.save();

  emitEvent(req, ALERT, chat.members, {
    message: `${userThatWillBeRemoved.name} has been removed from the group`,
    chatId,
  });

  emitEvent(req, REFETCH_CHATS, allChatMembers);

  return res.status(200).json({
    success: true,
    message: "Member removed successfully",
  });
});

const leaveGroup = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  const remainingMembers = chat.members.filter(
    (member) => member.toString() !== req.user.toString()
  );

  if (remainingMembers.length < 3)
    return next(new ErrorHandler("Group must have at least 3 members", 400));

  if (chat.creator.toString() === req.user.toString()) {
    const randomElement = Math.floor(Math.random() * remainingMembers.length);
    const newCreator = remainingMembers[randomElement];
    chat.creator = newCreator;
  }

  chat.members = remainingMembers;

  const [user] = await Promise.all([
    User.findById(req.user, "name"),
    chat.save(),
  ]);

  emitEvent(req, ALERT, chat.members, {
    chatId,
    message: `User ${user.name} has left the group`,
  });

  return res.status(200).json({
    success: true,
    message: "Leave Group Successfully",
  });
});

const sendAttachments = TryCatch(async (req, res, next) => {
  const { chatId } = req.body;

  const files = req.files || [];

  if (files.length < 1)
    return next(new ErrorHandler("Please Upload Attachments", 400));

  if (files.length > 5)
    return next(new ErrorHandler("Files Can't be more than 5", 400));

  const [chat, me] = await Promise.all([
    Chat.findById(chatId),
    User.findById(req.user, "name"),
  ]);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (files.length < 1)
    return next(new ErrorHandler("Please provide attachments", 400));

  //   Upload files here
  const attachments = await uploadFilesToCloudinary(files);

  const messageForDB = {
    content: "",
    attachments,
    sender: me._id,
    chat: chatId,
    recipientAcks: buildRecipientAcks(chat.members, me._id),
  };

  const created = await Message.create(messageForDB);

  const saved = await Message.findById(created._id)
    .populate("sender", "name")
    .lean();

  const messageForRealTime = {
    _id: saved._id,
    content: saved.content || "",
    attachments: saved.attachments || [],
    sender: {
      _id: saved.sender._id,
      name: saved.sender.name,
    },
    chat: chatId,
    createdAt: saved.createdAt,
    recipientAcks: saved.recipientAcks || [],
  };

  emitEvent(req, NEW_MESSAGE, chat.members, {
    message: messageForRealTime,
    chatId,
  });

  emitEvent(req, NEW_MESSAGE_ALERT, chat.members, { chatId });

  return res.status(200).json({
    success: true,
    message: created,
  });
});

const getChatDetails = TryCatch(async (req, res, next) => {
  if (req.query.populate === "true") {
    const chat = await Chat.findById(req.params.id)
      .populate("members", "name avatar")
      .lean();

    if (!chat) return next(new ErrorHandler("Chat not found", 404));

    chat.members = chat.members.map(({ _id, name, avatar }) => ({
      _id,
      name,
      avatar: avatar.url,
    }));

    return res.status(200).json({
      success: true,
      chat,
    });
  } else {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return next(new ErrorHandler("Chat not found", 404));

    return res.status(200).json({
      success: true,
      chat,
    });
  }
});

const renameGroup = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const { name } = req.body;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not allowed to rename the group", 403)
    );

  chat.name = name;

  await chat.save();

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Group renamed successfully",
  });
});

const deleteChat = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  const members = chat.members;

  if (chat.groupChat && chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not allowed to delete the group", 403)
    );

  if (!chat.groupChat && !isChatMember(chat, req.user)) {
    return next(
      new ErrorHandler("You are not allowed to delete the chat", 403)
    );
  }

  //   Here we have to dete All Messages as well as attachments or files from cloudinary

  const messagesWithAttachments = await Message.find({
    chat: chatId,
    attachments: { $exists: true, $ne: [] },
  });

  const public_ids = [];

  messagesWithAttachments.forEach(({ attachments }) =>
    attachments.forEach(({ public_id }) => public_ids.push(public_id))
  );

  await Promise.all([
    deletFilesFromCloudinary(public_ids),
    chat.deleteOne(),
    Message.deleteMany({ chat: chatId }),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Chat deleted successfully",
  });
});

const getMessages = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const { page = 1 } = req.query;

  const resultPerPage = 20;
  const skip = (page - 1) * resultPerPage;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!isChatMember(chat, req.user))
    return next(
      new ErrorHandler("You are not allowed to access this chat", 403)
    );

  const messageFilter = {
    chat: chatId,
    hiddenForUsers: { $nin: [req.user] },
  };

  const [messages, totalMessagesCount] = await Promise.all([
    Message.find(messageFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(resultPerPage)
      .populate("sender", "name")
      .populate("recipientAcks.user", "name")
      .populate({
        path: "replyTo",
        select: "content sender deletedForEveryone createdAt editedAt",
        populate: { path: "sender", select: "name" },
      })
      .lean(),
    Message.countDocuments(messageFilter),
  ]);

  const totalPages = Math.ceil(totalMessagesCount / resultPerPage) || 0;

  return res.status(200).json({
    success: true,
    messages: messages.reverse(),
    totalPages,
  });
});

const editMessage = TryCatch(async (req, res, next) => {
  const messageId = req.params.messageId;
  const trimmed = (req.body.content || "").trim();
  if (!trimmed)
    return next(new ErrorHandler("Message content required", 400));

  const msg = await Message.findById(messageId);
  if (!msg) return next(new ErrorHandler("Message not found", 404));
  if (msg.deletedForEveryone)
    return next(new ErrorHandler("Cannot edit a deleted message", 400));
  if (msg.sender.toString() !== req.user.toString())
    return next(new ErrorHandler("You can only edit your own messages", 403));

  const chat = await Chat.findById(msg.chat);
  if (!chat || !isChatMember(chat, req.user))
    return next(new ErrorHandler("Chat not found", 404));

  msg.content = trimmed;
  msg.editedAt = new Date();
  await msg.save();

  const populated = await Message.findById(msg._id)
    .populate("sender", "name")
    .populate("recipientAcks.user", "name")
    .lean();

  emitEvent(req, MESSAGE_EDITED, chat.members, {
    chatId: String(msg.chat),
    message: {
      _id: populated._id,
      content: populated.content,
      editedAt: populated.editedAt,
      recipientAcks: populated.recipientAcks || [],
    },
  });

  return res.status(200).json({ success: true, message: populated });
});

const deleteMessage = TryCatch(async (req, res, next) => {
  const messageId = req.params.messageId;
  const mode = (req.query.mode || "forMe").toLowerCase();

  const msg = await Message.findById(messageId);
  if (!msg) return next(new ErrorHandler("Message not found", 404));

  const chat = await Chat.findById(msg.chat);
  if (!chat || !isChatMember(chat, req.user))
    return next(new ErrorHandler("You are not allowed to access this chat", 403));

  if (mode === "foreveryone") {
    if (msg.sender.toString() !== req.user.toString())
      return next(
        new ErrorHandler("Only the sender can delete for everyone", 403)
      );
    if (msg.deletedForEveryone)
      return next(new ErrorHandler("Already deleted", 400));

    const publicIds = (msg.attachments || [])
      .map((a) => a.public_id)
      .filter(Boolean);
    if (publicIds.length) await deletFilesFromCloudinary(publicIds);

    msg.deletedForEveryone = true;
    msg.content = "";
    msg.attachments = [];
    await msg.save();

    emitEvent(req, MESSAGE_DELETED_EVERYONE, chat.members, {
      chatId: String(msg.chat),
      message: {
        _id: msg._id,
        content: "",
        attachments: [],
        deletedForEveryone: true,
        recipientAcks: msg.recipientAcks,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Deleted for everyone",
    });
  }

  await Message.updateOne(
    { _id: messageId },
    { $addToSet: { hiddenForUsers: req.user } }
  );

  emitEvent(req, MESSAGE_HIDDEN_FOR_USER, [req.user], {
    chatId: String(msg.chat),
    messageId: String(msg._id),
  });

  return res.status(200).json({ success: true, message: "Removed for you" });
});

const clearChatMessages = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const chat = await Chat.findById(chatId);
  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!isChatMember(chat, req.user))
    return next(new ErrorHandler("You are not allowed to clear this chat", 403));

  const messagesWithAttachments = await Message.find({
    chat: chatId,
    attachments: { $exists: true, $ne: [] },
  });
  const public_ids = [];
  messagesWithAttachments.forEach(({ attachments }) =>
    (attachments || []).forEach(({ public_id }) => {
      if (public_id) public_ids.push(public_id);
    })
  );

  await Promise.all([
    public_ids.length ? deletFilesFromCloudinary(public_ids) : Promise.resolve(),
    Message.deleteMany({ chat: chatId }),
  ]);

  emitEvent(req, REFETCH_CHATS, chat.members);
  emitEvent(req, NEW_MESSAGE_ALERT, chat.members, { chatId });

  return res.status(200).json({
    success: true,
    message: "All messages in this chat were cleared",
  });
});

const forwardMessage = TryCatch(async (req, res, next) => {
  const { sourceMessageId, targetChatId } = req.body;

  const src = await Message.findById(sourceMessageId)
    .populate("sender", "name")
    .select("content attachments chat deletedForEveryone sender");

  if (!src || src.deletedForEveryone)
    return next(new ErrorHandler("Message not found", 404));

  const [sourceChat, targetChat, me] = await Promise.all([
    Chat.findById(src.chat),
    Chat.findById(targetChatId),
    User.findById(req.user, "name"),
  ]);

  if (!sourceChat || !targetChat || !me)
    return next(new ErrorHandler("Chat not found", 404));

  if (!isChatMember(sourceChat, req.user) || !isChatMember(targetChat, req.user))
    return next(
      new ErrorHandler("You can only forward between chats you belong to", 403)
    );

  if (String(src.chat) === String(targetChatId))
    return next(new ErrorHandler("Choose a different chat to forward to", 400));

  const name = src.sender?.name || "Someone";
  const text = (src.content || "").trim();
  const fwdBody = text
    ? `↪️ ${name}: ${text}`
    : `↪️ ${name}: [attachment]`;

  const recipientAcks = buildRecipientAcks(targetChat.members, me._id);
  const created = await Message.create({
    content: fwdBody,
    sender: me._id,
    chat: targetChatId,
    recipientAcks,
    attachments: [],
  });

  const populated = await Message.findById(created._id)
    .populate("sender", "name")
    .lean();

  const messageForRealTime = {
    _id: populated._id,
    content: populated.content,
    chat: targetChatId,
    createdAt: populated.createdAt,
    attachments: [],
    sender: {
      _id: populated.sender._id,
      name: populated.sender.name,
    },
    recipientAcks: populated.recipientAcks || [],
    replyTo: null,
  };

  emitEvent(req, NEW_MESSAGE, targetChat.members, {
    chatId: targetChatId,
    message: messageForRealTime,
  });
  emitEvent(req, NEW_MESSAGE_ALERT, targetChat.members, { chatId: targetChatId });

  return res.status(201).json({
    success: true,
    message: messageForRealTime,
  });
});

const getCallHistory = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const chat = await Chat.findById(chatId);
  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!isChatMember(chat, req.user))
    return next(
      new ErrorHandler("You are not allowed to access this chat", 403)
    );

  const calls = await CallLog.find({ chat: chatId })
    .sort({ startedAt: -1 })
    .limit(40)
    .populate("caller", "name")
    .populate("callee", "name")
    .lean();

  return res.status(200).json({ success: true, calls });
});

export {
  newGroupChat,
  getMyChats,
  getOrCreateSelfChat,
  getMyGroups,
  addMembers,
  removeMember,
  leaveGroup,
  sendAttachments,
  getChatDetails,
  renameGroup,
  deleteChat,
  clearChatMessages,
  forwardMessage,
  getMessages,
  editMessage,
  deleteMessage,
  getCallHistory,
};
