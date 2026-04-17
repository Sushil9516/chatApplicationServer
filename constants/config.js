import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

/** Default production clients (extend with CLIENT_URL on the host, comma-separated). */
const DEFAULT_CLIENT_ORIGINS = [
  "https://chatr-theta.vercel.app",
  "https://chat-application-client-theta.vercel.app",
];

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

/** First CLIENT_URL entry for emails; otherwise the primary default deployment. */
export function getPrimaryClientUrl() {
  const fromEnv = parseClientUrls(process.env.CLIENT_URL);
  if (fromEnv.length > 0) return fromEnv[0];
  return DEFAULT_CLIENT_ORIGINS[0];
}

/** Cookie names — unchanged from original app; product UI name is separate. */
const CHATTU_TOKEN = "chattu-token";
const CHATTU_ADMIN_TOKEN = "chattu-admin-token";

export { corsOptions, CHATTU_TOKEN, CHATTU_ADMIN_TOKEN };
