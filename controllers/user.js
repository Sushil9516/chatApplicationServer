import crypto from "node:crypto";
import { compare } from "bcrypt";
import { NEW_REQUEST, REFETCH_CHATS } from "../constants/events.js";
import { getOtherMember, isChatMember } from "../lib/helper.js";
import { TryCatch } from "../middlewares/error.js";
import { Chat } from "../models/chat.js";
import { Request } from "../models/request.js";
import { User } from "../models/user.js";
import {
  cookieOptions,
  deletFilesFromCloudinary,
  emitEvent,
  sendToken,
  uploadFilesToCloudinary,
} from "../utils/features.js";
import { CHATTU_TOKEN, getPrimaryClientUrl } from "../constants/config.js";
import { ErrorHandler } from "../utils/utility.js";
import { sendPasswordResetEmail } from "../utils/email.js";

/** Reset links must open where the user is browsing (localhost in dev, prod URL when deployed). */
function resolveResetBaseUrl(req) {
  const envBase = getPrimaryClientUrl();
  const origin = (req.get("origin") || "").trim().replace(/\/$/, "");
  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  if (isLocal) return origin;
  if (envBase) return envBase;
  if (origin) return origin;
  return "http://localhost:5173";
}

// Create a new user and save it to the database and save token in cookie
const newUser = TryCatch(async (req, res, next) => {
  const { name, username, password, bio, email } = req.body;
  const emailNorm = (email || "").trim().toLowerCase();
  if (!emailNorm)
    return next(new ErrorHandler("Please provide an email address", 400));

  const dupEmail = await User.findOne({ email: emailNorm });
  if (dupEmail) return next(new ErrorHandler("Email is already registered", 400));

  const file = req.file;

  if (!file) return next(new ErrorHandler("Please Upload Avatar"));

  const result = await uploadFilesToCloudinary([file]);

  const avatar = {
    public_id: result[0].public_id,
    url: result[0].url,
  };

  const user = await User.create({
    name,
    bio,
    username,
    password,
    email: emailNorm,
    avatar,
    authProvider: "local",
  });

  sendToken(res, user, 201, "User created");
});

// Login user and save token in cookie
const login = TryCatch(async (req, res, next) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username }).select("+password");

  if (!user) return next(new ErrorHandler("Invalid Username or Password", 404));

  if (!user.password)
    return next(
      new ErrorHandler("This account uses Google sign-in", 400)
    );

  const isMatch = await compare(password, user.password);

  if (!isMatch)
    return next(new ErrorHandler("Invalid Username or Password", 404));

  sendToken(res, user, 200, `Welcome Back, ${user.name}`);
});

const getMyProfile = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);

  if (!user) return next(new ErrorHandler("User not found", 404));

  res.status(200).json({
    success: true,
    user,
  });
});

const togglePinChat = TryCatch(async (req, res, next) => {
  const chatId = (req.body.chatId || "").trim();
  if (!chatId) return next(new ErrorHandler("chatId is required", 400));

  const chat = await Chat.findById(chatId);
  if (!chat || !isChatMember(chat, req.user))
    return next(new ErrorHandler("Chat not found", 404));

  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  const list = user.pinnedChats || [];
  const ids = list.map((id) => id.toString());
  const idx = ids.indexOf(chatId);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.unshift(chat._id);
  }
  user.pinnedChats = list;
  await user.save();

  const fresh = await User.findById(req.user).select("-password").lean();
  return res.status(200).json({
    success: true,
    user: fresh,
    message: idx >= 0 ? "Chat unpinned" : "Chat pinned",
  });
});

const logout = TryCatch(async (req, res) => {
  return res
    .status(200)
    .cookie(CHATTU_TOKEN, "", { ...cookieOptions, maxAge: 0 })
    .json({
      success: true,
      message: "Logged out successfully",
    });
});

const searchUser = TryCatch(async (req, res) => {
  const { name = "" } = req.query;

  // Finding All my chats
  const myChats = await Chat.find({ groupChat: false, members: req.user });

  //  extracting All Users from my chats means friends or people I have chatted with
  const allUsersFromMyChats = myChats.flatMap((chat) => chat.members);

  // Finding all users except me and my friends
  const allUsersExceptMeAndFriends = await User.find({
    _id: { $nin: allUsersFromMyChats },
    name: { $regex: name, $options: "i" },
  });

  // Modifying the response
  const users = allUsersExceptMeAndFriends.map(({ _id, name, avatar }) => ({
    _id,
    name,
    avatar: avatar.url,
  }));

  return res.status(200).json({
    success: true,
    users,
  });
});

const sendFriendRequest = TryCatch(async (req, res, next) => {
  const { userId } = req.body;

  const request = await Request.findOne({
    $or: [
      { sender: req.user, receiver: userId },
      { sender: userId, receiver: req.user },
    ],
  });

  if (request) return next(new ErrorHandler("Request already sent", 400));

  await Request.create({
    sender: req.user,
    receiver: userId,
  });

  emitEvent(req, NEW_REQUEST, [userId]);

  return res.status(200).json({
    success: true,
    message: "Friend Request Sent",
  });
});

const acceptFriendRequest = TryCatch(async (req, res, next) => {
  const { requestId, accept } = req.body;

  const request = await Request.findById(requestId)
    .populate("sender", "name")
    .populate("receiver", "name");

  if (!request) return next(new ErrorHandler("Request not found", 404));

  if (request.receiver._id.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to accept this request", 401)
    );

  if (!accept) {
    await request.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Friend Request Rejected",
    });
  }

  const members = [request.sender._id, request.receiver._id];

  await Promise.all([
    Chat.create({
      members,
      name: `${request.sender.name}-${request.receiver.name}`,
    }),
    request.deleteOne(),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Friend Request Accepted",
    senderId: request.sender._id,
  });
});

const getMyNotifications = TryCatch(async (req, res) => {
  const requests = await Request.find({ receiver: req.user }).populate(
    "sender",
    "name avatar"
  );

  const allRequests = requests.map(({ _id, sender }) => ({
    _id,
    sender: {
      _id: sender._id,
      name: sender.name,
      avatar: sender.avatar.url,
    },
  }));

  return res.status(200).json({
    success: true,
    allRequests,
  });
});

const changePassword = TryCatch(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user).select("+password");
  if (!user) return next(new ErrorHandler("User not found", 404));
  if (!user.password)
    return next(
      new ErrorHandler(
        "This account uses Google sign-in. Password cannot be changed here.",
        400
      )
    );

  const isMatch = await compare(currentPassword, user.password);
  if (!isMatch)
    return next(new ErrorHandler("Current password is incorrect", 400));

  user.password = newPassword;
  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password updated successfully",
  });
});

const updateProfile = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  const { name, bio, username, email } = req.body;
  const hasFile = Boolean(req.file);
  const hasAnyField =
    name !== undefined ||
    bio !== undefined ||
    username !== undefined ||
    email !== undefined ||
    hasFile;
  if (!hasAnyField)
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
      if (e !== user.email) {
        const taken = await User.findOne({ email: e, _id: { $ne: user._id } });
        if (taken) return next(new ErrorHandler("Email is already in use", 400));
        user.email = e;
      }
    }
  }

  if (hasFile) {
    const result = await uploadFilesToCloudinary([req.file]);
    const oldPid = user.avatar?.public_id;
    user.avatar = {
      public_id: result[0].public_id,
      url: result[0].url,
    };
    if (oldPid && !String(oldPid).startsWith("google_avatar_")) {
      await deletFilesFromCloudinary([oldPid]);
    }
  }

  await user.save();
  const fresh = await User.findById(user._id);

  return res.status(200).json({
    success: true,
    user: fresh,
    message: "Profile updated",
  });
});

const forgotPassword = TryCatch(async (req, res, next) => {
  const emailNorm = (req.body.email || "").trim().toLowerCase();
  const generic =
    "If an account exists for that email, you will receive password reset instructions shortly.";

  const user = await User.findOne({ email: emailNorm }).select("+password");

  if (!user || !user.password) {
    return res.status(200).json({ success: true, message: generic });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(resetToken).digest("hex");
  user.passwordResetToken = hashed;
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  const base = resolveResetBaseUrl(req);
  const resetUrl = `${base}/reset-password?token=${resetToken}`;

  try {
    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    const msg = err?.message || "Could not send email";
    const code = err.statusCode || 500;
    return next(new ErrorHandler(msg, code));
  }

  return res.status(200).json({ success: true, message: generic });
});

const resetPassword = TryCatch(async (req, res, next) => {
  const { token, password } = req.body;
  if (!token || !password)
    return next(new ErrorHandler("Token and new password are required", 400));

  const hashed = crypto.createHash("sha256").update(String(token)).digest("hex");
  const user = await User.findOne({
    passwordResetToken: hashed,
    passwordResetExpires: { $gt: new Date() },
  }).select("+password +passwordResetToken +passwordResetExpires");

  if (!user)
    return next(
      new ErrorHandler("Invalid or expired reset link. Request a new one.", 400)
    );

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password updated. You can sign in with your new password.",
  });
});

const getMyFriends = TryCatch(async (req, res) => {
  const chatId = req.query.chatId;

  const chats = await Chat.find({
    members: req.user,
    groupChat: false,
  }).populate("members", "name avatar");

  const friends = chats
    .map(({ members }) => {
      const otherUser = getOtherMember(members, req.user);
      if (!otherUser?._id) return null;

      return {
        _id: otherUser._id,
        name: otherUser.name,
        avatar: otherUser.avatar?.url || "",
      };
    })
    .filter(Boolean);

  if (chatId) {
    const chat = await Chat.findById(chatId);

    const availableFriends = friends.filter(
      (friend) => !chat.members.includes(friend._id)
    );

    return res.status(200).json({
      success: true,
      friends: availableFriends,
    });
  } else {
    return res.status(200).json({
      success: true,
      friends,
    });
  }
});

export {
  acceptFriendRequest,
  changePassword,
  forgotPassword,
  getMyFriends,
  getMyNotifications,
  getMyProfile,
  login,
  logout,
  newUser,
  resetPassword,
  searchUser,
  sendFriendRequest,
  togglePinChat,
  updateProfile,
};
