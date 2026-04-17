import { OAuth2Client } from "google-auth-library";
import { TryCatch } from "../middlewares/error.js";
import { ErrorHandler } from "../utils/utility.js";
import { User } from "../models/user.js";
import { sendAuthTokenResponse } from "../utils/features.js";

const googleClientId = () =>
  (process.env.GOOGLE_CLIENT_ID || "").trim() || undefined;

const client = () => new OAuth2Client(googleClientId());

async function generateUniqueUsername(baseSource) {
  const raw = (baseSource || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  const base = raw.length >= 3 ? raw : `user_${raw || "g"}`;

  let candidate = base;
  let n = 0;
  while (await User.exists({ username: candidate })) {
    n += 1;
    candidate = `${base.slice(0, 18)}_${n}${Math.random().toString(36).slice(2, 6)}`;
  }
  return candidate;
}

/**
 * POST /api/v1/auth/google
 * Body: { credential } — Google ID token (JWT) from GIS / @react-oauth/google
 */
const googleAuth = TryCatch(async (req, res, next) => {
  const credential = req.body.credential;
  if (!credential)
    return next(new ErrorHandler("Google credential is required", 400));

  const audience = googleClientId();
  if (!audience)
    return next(
      new ErrorHandler("Google Sign-In is not configured on the server", 500)
    );

  let payload;
  try {
    const ticket = await client().verifyIdToken({
      idToken: credential,
      audience,
    });
    payload = ticket.getPayload();
  } catch {
    return next(new ErrorHandler("Invalid or expired Google token", 401));
  }

  const sub = payload.sub;
  const email = (payload.email || "").toLowerCase().trim();
  const name = payload.name || email.split("@")[0] || "User";
  const picture = payload.picture || "";

  if (!sub)
    return next(new ErrorHandler("Invalid Google account payload", 400));

  let user = await User.findOne({ googleId: sub });

  if (!user && email) {
    user = await User.findOne({ email });
    if (user && user.googleId && user.googleId !== sub) {
      return next(
        new ErrorHandler("This email is already linked to another Google account", 409)
      );
    }
    if (user && !user.googleId) {
      user.googleId = sub;
      user.authProvider = "google";
      if (picture) {
        user.avatar = {
          public_id: user.avatar?.public_id || `google_${sub}`,
          url: picture,
        };
      }
      await user.save();
    }
  }

  if (!user) {
    const username = await generateUniqueUsername(
      email ? email.split("@")[0] : name
    );
    user = await User.create({
      name,
      email: email || undefined,
      googleId: sub,
      authProvider: "google",
      bio: "Hey there! I am using Chatr.",
      username,
      avatar: {
        public_id: `google_avatar_${sub}`,
        url: picture || "https://ui-avatars.com/api/?name=" + encodeURIComponent(name),
      },
    });
  }

  const fresh = await User.findById(user._id);
  if (!fresh) return next(new ErrorHandler("User not found", 404));

  return sendAuthTokenResponse(res, fresh, 200, `Welcome, ${fresh.name}`);
});

export { googleAuth };
