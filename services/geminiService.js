import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT =
  "You are a helpful AI assistant inside a chat app. Reply short, conversational, and like WhatsApp messages.";

/**
 * Models have no live clock — inject server time so "today" / date questions are accurate.
 * Optional: set GEMINI_TIMEZONE (e.g. Asia/Kolkata) in .env for an extra local line in the prompt.
 */
function buildSystemInstruction() {
  const now = new Date();
  const iso = now.toISOString();
  const utcLine = `UTC: ${now.toUTCString()}`;

  const tz = process.env.GEMINI_TIMEZONE?.trim();
  let localLine = "";
  if (tz) {
    try {
      const local = now.toLocaleString("en-US", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
      localLine = `Local (${tz}): ${local}`;
    } catch {
      localLine = "";
    }
  }

  const serverLocale = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return `${SYSTEM_PROMPT}

Ground truth for the current moment (use ONLY this for "today", "current date", time, or calendar questions; never invent dates):
- ISO 8601: ${iso}
- Server locale string: ${serverLocale}
- ${utcLine}${localLine ? `\n- ${localLine}` : ""}

If you are unsure about real-time facts outside this timestamp, say you only know the time as of the values above.`;
}

/** Older IDs like gemini-1.5-flash often return 404 on current Generative Language API. */
const DEFAULT_MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.5-flash-lite",
];

const MAX_MESSAGE_LEN = 8000;
const MAX_HISTORY_TURNS = 24;

function isModelNotFoundError(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("404") ||
    msg.includes("Not Found") ||
    msg.includes("not found") ||
    msg.includes("is not supported")
  );
}

function buildHistoryParts(history) {
  const safeHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
  const formatted = [];
  for (const h of safeHistory) {
    if (!h || typeof h.text !== "string") continue;
    const text = h.text.trim();
    if (!text) continue;
    const role =
      h.role === "assistant" || h.role === "model" ? "model" : "user";
    formatted.push({ role, parts: [{ text }] });
  }
  return formatted;
}

/**
 * @param {{ message: string; history?: Array<{ role: string; text: string }> }} params
 * @returns {Promise<string>}
 */
export async function generateGeminiReply({ message, history = [] }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      "AI is not configured. Add GEMINI_API_KEY to chatApplicationServer/.env (get a key at https://aistudio.google.com/apikey ) then restart the server."
    );
    err.statusCode = 503;
    throw err;
  }

  const trimmed = (message || "").trim();
  if (!trimmed) {
    const err = new Error("message is required");
    err.statusCode = 400;
    throw err;
  }
  if (trimmed.length > MAX_MESSAGE_LEN) {
    const err = new Error(`message too long (max ${MAX_MESSAGE_LEN} characters)`);
    err.statusCode = 400;
    throw err;
  }

  const envModel = process.env.GEMINI_MODEL?.trim();
  const candidates = envModel
    ? [envModel, ...DEFAULT_MODEL_CANDIDATES.filter((m) => m !== envModel)]
    : [...DEFAULT_MODEL_CANDIDATES];

  const formatted = buildHistoryParts(history);
  const genAI = new GoogleGenerativeAI(apiKey);

  let lastError = null;
  for (const modelId of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: buildSystemInstruction(),
      });
      const chat = model.startChat({ history: formatted });
      const result = await chat.sendMessage(trimmed);
      const reply = result.response?.text?.() ?? "";
      if (!reply || !String(reply).trim()) {
        const err = new Error("Empty response from model");
        err.statusCode = 502;
        throw err;
      }
      return String(reply).trim();
    } catch (e) {
      lastError = e;
      if (isModelNotFoundError(e)) continue;
      throw e;
    }
  }

  const err = new Error(
    `No working Gemini model found. Tried: ${candidates.join(", ")}. Set GEMINI_MODEL in .env to an ID from https://ai.google.dev/gemini-api/docs/models — ${lastError?.message || ""}`
  );
  err.statusCode = 502;
  throw err;
}
