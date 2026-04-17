import { userSocketIDs } from "../app.js";

export const getOtherMember = (members, userId) =>
  members.find((member) => memberIdString(member) !== userId.toString());

export const isChatMember = (chat, userId) =>
  chat.members.some((m) => m.toString() === userId.toString());

/** One entry per recipient (every chat member except the sender). */
export const buildRecipientAcks = (memberIds, senderId) =>
  memberIds
    .filter((m) => m.toString() !== senderId.toString())
    .map((m) => ({ user: m }));

/** Normalize chat member from DB ObjectId, string, or client JSON `{ _id }`. */
export const memberIdString = (m) => {
  if (m == null) return "";
  if (typeof m === "string" || typeof m === "number") return String(m);
  if (typeof m === "object" && m._id != null) return String(m._id);
  if (typeof m?.toString === "function") {
    const s = m.toString();
    if (s && s !== "[object Object]") return s;
  }
  return "";
};

export const getSockets = (users = []) => {
  if (!Array.isArray(users)) return [];
  return users
    .map((u) => userSocketIDs.get(memberIdString(u)))
    .filter(Boolean);
};

export const getBase64 = (file) =>
  `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
