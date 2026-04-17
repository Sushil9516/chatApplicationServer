import mongoose, { Schema, model, Types } from "mongoose";

const schema = new Schema(
  {
    content: String,

    attachments: [
      {
        public_id: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
      },
    ],

    sender: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },

    /** Optional reply-to message in the same chat (WhatsApp-style). */
    replyTo: {
      type: Types.ObjectId,
      ref: "Message",
      default: undefined,
    },

    chat: {
      type: Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    recipientAcks: [
      {
        user: { type: Types.ObjectId, ref: "User", required: true },
        deliveredAt: { type: Date },
        readAt: { type: Date },
      },
    ],

    editedAt: { type: Date },

    /** Sender removed content for all members (WhatsApp-style recall). */
    deletedForEveryone: { type: Boolean, default: false },

    /** Users who chose delete-for-me; hidden only for them. */
    hiddenForUsers: [{ type: Types.ObjectId, ref: "User" }],
  },
  {
    timestamps: true,
  }
);

export const Message = mongoose.models.Message || model("Message", schema);
