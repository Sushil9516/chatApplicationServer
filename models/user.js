import mongoose, { Schema, model } from "mongoose";
import { hash } from "bcrypt";

const schema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    bio: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    username: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      select: false,
    },
    avatar: {
      public_id: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
    },

    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    /** Chats pinned to the top of the inbox (order preserved). */
    pinnedChats: {
      type: [{ type: Schema.Types.ObjectId, ref: "Chat" }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

schema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();

  this.password = await hash(this.password, 10);
  next();
});

export const User = mongoose.models.User || model("User", schema);
