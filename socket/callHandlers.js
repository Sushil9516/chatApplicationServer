import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { assertDirectChatPeer } from "../controllers/callController.js";
import { CallLog } from "../models/callLog.js";
import {
  ACCEPT_CALL,
  ANSWER,
  CALL_ERROR,
  CALL_USER,
  END_CALL,
  ICE_CANDIDATE,
  INCOMING_CALL,
  OFFER,
  REJECT_CALL,
} from "../constants/callEvents.js";

/** @type {Map<string, { callerId: string, calleeId: string, chatId: string, callType: string, logId?: import('mongoose').Types.ObjectId }>} */
const pendingCalls = new Map();

/** @type {Map<string, { a: string, b: string, chatId: string, callType: string, logId?: import('mongoose').Types.ObjectId, connectedAt?: Date }>} */
const activeCalls = new Map();

/** userId -> callId (pending or active) */
const userCall = new Map();

async function patchCallLog(logId, patch) {
  if (!logId) return;
  try {
    await CallLog.findByIdAndUpdate(logId, patch);
  } catch (e) {
    console.error("CallLog patch error:", e);
  }
}

function clearCall(callId) {
  const pending = pendingCalls.get(callId);
  if (pending) {
    pendingCalls.delete(callId);
    userCall.delete(pending.callerId);
    userCall.delete(pending.calleeId);
    return;
  }
  const active = activeCalls.get(callId);
  if (active) {
    activeCalls.delete(callId);
    userCall.delete(active.a);
    userCall.delete(active.b);
  }
}

function emitToUser(io, getUserSocketId, userId, event, payload) {
  const sid = getUserSocketId(userId);
  if (sid) io.to(sid).emit(event, payload);
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {import('mongoose').Document} user
 * @param {{ getUserSocketId: (userId: string) => string | undefined }} registry
 */
export function registerCallHandlers(io, socket, user, { getUserSocketId }) {
  const myId = user._id.toString();

  socket.on(CALL_USER, async (payload, ack) => {
    try {
      const { toUserId, chatId, callType } = payload || {};
      if (!toUserId || !chatId || !["audio", "video"].includes(callType)) {
        socket.emit(CALL_ERROR, { message: "Invalid call payload" });
        return ack?.({ ok: false });
      }

      const gate = await assertDirectChatPeer(chatId, myId);
      if (!gate.ok) {
        socket.emit(CALL_ERROR, { message: gate.error });
        return ack?.({ ok: false });
      }
      if (gate.otherMemberId !== String(toUserId)) {
        socket.emit(CALL_ERROR, {
          message: "Target user is not the other member of this chat",
        });
        return ack?.({ ok: false });
      }

      if (userCall.has(myId) || userCall.has(String(toUserId))) {
        socket.emit(CALL_ERROR, { message: "User is already in a call" });
        return ack?.({ ok: false });
      }

      const callId = randomUUID();
      const log = await CallLog.create({
        callId,
        chat: new mongoose.Types.ObjectId(String(chatId)),
        caller: new mongoose.Types.ObjectId(myId),
        callee: new mongoose.Types.ObjectId(String(toUserId)),
        callType,
        status: "ringing",
        startedAt: new Date(),
      });

      pendingCalls.set(callId, {
        callerId: myId,
        calleeId: String(toUserId),
        chatId: String(chatId),
        callType,
        logId: log._id,
      });
      userCall.set(myId, callId);
      userCall.set(String(toUserId), callId);

      const calleeSocket = getUserSocketId(String(toUserId));
      if (!calleeSocket) {
        await patchCallLog(log._id, {
          status: "cancelled",
          endedAt: new Date(),
        });
        clearCall(callId);
        socket.emit(CALL_ERROR, { message: "User is offline" });
        return ack?.({ ok: false });
      }

      emitToUser(io, getUserSocketId, String(toUserId), INCOMING_CALL, {
        callId,
        chatId: String(chatId),
        callType,
        from: { _id: user._id, name: user.name },
      });

      ack?.({ ok: true, callId });
    } catch (e) {
      console.error(CALL_USER, e);
      socket.emit(CALL_ERROR, { message: "Could not start call" });
      ack?.({ ok: false });
    }
  });

  socket.on(ACCEPT_CALL, async (payload, ack) => {
    try {
      const { callId } = payload || {};
      const pend = pendingCalls.get(callId);
      if (!pend || pend.calleeId !== myId) {
        socket.emit(CALL_ERROR, { message: "No matching incoming call" });
        return ack?.({ ok: false });
      }

      pendingCalls.delete(callId);
      const connectedAt = new Date();
      activeCalls.set(callId, {
        a: pend.callerId,
        b: pend.calleeId,
        chatId: pend.chatId,
        callType: pend.callType,
        logId: pend.logId,
        connectedAt,
      });

      await patchCallLog(pend.logId, {
        status: "active",
        connectedAt,
      });

      emitToUser(io, getUserSocketId, pend.callerId, ACCEPT_CALL, {
        callId,
        chatId: pend.chatId,
        callType: pend.callType,
        acceptedBy: { _id: user._id, name: user.name },
      });

      ack?.({ ok: true });
    } catch (e) {
      console.error(ACCEPT_CALL, e);
      socket.emit(CALL_ERROR, { message: "Accept failed" });
      ack?.({ ok: false });
    }
  });

  socket.on(REJECT_CALL, async (payload) => {
    const { callId } = payload || {};
    const pend = pendingCalls.get(callId);
    if (!pend || pend.calleeId !== myId) return;

    await patchCallLog(pend.logId, {
      status: "declined",
      endedAt: new Date(),
    });
    clearCall(callId);
    emitToUser(io, getUserSocketId, pend.callerId, REJECT_CALL, {
      callId,
      reason: "declined",
    });
  });

  const relaySdp = (eventName, payload) => {
    const { callId, sdp } = payload || {};
    if (!callId || !sdp) return;
    const act = activeCalls.get(callId);
    if (!act || (act.a !== myId && act.b !== myId)) return;
    const peer = act.a === myId ? act.b : act.a;
    emitToUser(io, getUserSocketId, peer, eventName, {
      callId,
      sdp,
      from: myId,
    });
  };

  socket.on(OFFER, (p) => relaySdp(OFFER, p));
  socket.on(ANSWER, (p) => relaySdp(ANSWER, p));

  socket.on(ICE_CANDIDATE, (payload) => {
    const { callId, candidate } = payload || {};
    if (!callId || !candidate) return;
    const act = activeCalls.get(callId);
    if (!act || (act.a !== myId && act.b !== myId)) return;
    const peer = act.a === myId ? act.b : act.a;
    emitToUser(io, getUserSocketId, peer, ICE_CANDIDATE, {
      callId,
      candidate,
      from: myId,
    });
  });

  socket.on(END_CALL, async (payload) => {
    const { callId } = payload || {};
    if (!callId) return;

    const pend = pendingCalls.get(callId);
    if (pend) {
      if (pend.callerId === myId || pend.calleeId === myId) {
        const peer = pend.callerId === myId ? pend.calleeId : pend.callerId;
        const status =
          pend.callerId === myId ? "cancelled" : "missed";
        await patchCallLog(pend.logId, {
          status,
          endedAt: new Date(),
        });
        clearCall(callId);
        emitToUser(io, getUserSocketId, peer, END_CALL, {
          callId,
          endedBy: myId,
        });
      }
      return;
    }

    const act = activeCalls.get(callId);
    if (!act || (act.a !== myId && act.b !== myId)) return;
    const peer = act.a === myId ? act.b : act.a;
    const endedAt = new Date();
    const sec = act.connectedAt
      ? Math.max(0, (endedAt - act.connectedAt) / 1000)
      : 0;
    await patchCallLog(act.logId, {
      status: "completed",
      endedAt,
      durationSeconds: Math.round(sec),
    });
    clearCall(callId);
    emitToUser(io, getUserSocketId, peer, END_CALL, { callId, endedBy: myId });
  });

  socket.on("disconnect", async () => {
    const callId = userCall.get(myId);
    if (!callId) return;

    const pend = pendingCalls.get(callId);
    if (pend) {
      const peer = pend.callerId === myId ? pend.calleeId : pend.callerId;
      const status = pend.callerId === myId ? "cancelled" : "missed";
      await patchCallLog(pend.logId, {
        status,
        endedAt: new Date(),
      });
      clearCall(callId);
      emitToUser(io, getUserSocketId, peer, END_CALL, {
        callId,
        endedBy: myId,
        reason: "disconnect",
      });
      return;
    }

    const act = activeCalls.get(callId);
    if (act) {
      const peer = act.a === myId ? act.b : act.a;
      const endedAt = new Date();
      const sec = act.connectedAt
        ? Math.max(0, (endedAt - act.connectedAt) / 1000)
        : 0;
      await patchCallLog(act.logId, {
        status: "completed",
        endedAt,
        durationSeconds: Math.round(sec),
      });
      clearCall(callId);
      emitToUser(io, getUserSocketId, peer, END_CALL, {
        callId,
        endedBy: myId,
        reason: "disconnect",
      });
    }
  });
}
