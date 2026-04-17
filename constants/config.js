/**
 * Server environment: configure **only** `chatApplicationServer/.env` (same folder as `app.js`).
 * Common keys: CLIENT_URL, MONGO_URI, JWT_SECRET, PORT, CLOUDINARY_* , GOOGLE_CLIENT_ID,
 * SMTP_* / MAIL_FROM, GEMINI_API_KEY, ADMIN_SECRET_KEY, WEBRTC_ICE_SERVERS (JSON array for TURN).
 *
 * Production web app URL (CORS + password-reset when not on localhost):
 *   CLIENT_URL=https://chatr-theta.vercel.app
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

/** Production SPA (comma-separated CLIENT_URL in .env merges with this). */
const DEFAULT_CLIENT_ORIGINS = ["https://chatr-theta.vercel.app"];

export function parseClientUrls(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function buildCorsOrigins() {
  const fromEnv = parseClientUrls(process.env.CLIENT_URL);
  const merged = [...LOCAL_ORIGINS, ...DEFAULT_CLIENT_ORIGINS, ...fromEnv];
  return [...new Set(merged)];
}

const corsOptions = {
  origin: buildCorsOrigins(),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
};

/** First CLIENT_URL from .env for emails; otherwise the default deployment above. */
export function getPrimaryClientUrl() {
  const fromEnv = parseClientUrls(process.env.CLIENT_URL);
  if (fromEnv.length > 0) return fromEnv[0];
  return DEFAULT_CLIENT_ORIGINS[0];
}

/** Cookie names — unchanged from original app; product UI name is separate. */
const CHATTU_TOKEN = "chattu-token";
const CHATTU_ADMIN_TOKEN = "chattu-admin-token";

export { corsOptions, CHATTU_TOKEN, CHATTU_ADMIN_TOKEN };
