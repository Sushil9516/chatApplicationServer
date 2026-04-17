import { Chat } from "../models/chat.js";

/**
 * Ensures the chat exists, is not a group, has exactly two members, and user is a member.
 * @returns {{ ok: true, otherMemberId: string } | { ok: false, error: string }}
 */
export async function assertDirectChatPeer(chatId, userId) {
  const chat = await Chat.findById(chatId).select("members groupChat");
  if (!chat) return { ok: false, error: "Chat not found" };
  if (chat.groupChat || chat.members.length !== 2) {
    return { ok: false, error: "Voice and video calls are only available in 1-to-1 chats" };
  }
  const uid = userId.toString();
  if (!chat.members.some((m) => m.toString() === uid)) {
    return { ok: false, error: "You are not a member of this chat" };
  }
  const other = chat.members.find((m) => m.toString() !== uid);
  return { ok: true, otherMemberId: other.toString() };
}
