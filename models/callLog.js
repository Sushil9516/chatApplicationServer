import mongoose, { Schema, model, Types } from "mongoose";

const schema = new Schema(
  {
    callId: { type: String, required: true, index: true },
    chat: { type: Types.ObjectId, ref: "Chat", required: true, index: true },
    caller: { type: Types.ObjectId, ref: "User", required: true },
    callee: { type: Types.ObjectId, ref: "User", required: true },
    callType: { type: String, enum: ["audio", "video"], required: true },
    status: {
      type: String,
      enum: [
        "ringing",
        "active",
        "completed",
        "declined",
        "cancelled",
        "missed",
      ],
      default: "ringing",
    },
    startedAt: { type: Date, default: Date.now },
    connectedAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number },
  },
  { timestamps: true }
);

export const CallLog = mongoose.models.CallLog || model("CallLog", schema);
