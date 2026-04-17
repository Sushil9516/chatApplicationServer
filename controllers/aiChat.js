import { TryCatch } from "../middlewares/error.js";
import { ErrorHandler } from "../utils/utility.js";
import { generateGeminiReply } from "../services/geminiService.js";

/**
 * POST /api/v1/ai-chat
 * Body: { message: string, history?: { role: 'user'|'assistant', text: string }[] }
 * Response: { reply: string }
 */
const postAiChat = TryCatch(async (req, res, next) => {
  const { message, history } = req.body;

  if (message === undefined || message === null) {
    return next(new ErrorHandler("message is required", 400));
  }

  try {
    const reply = await generateGeminiReply({ message, history });
    return res.status(200).json({ reply });
  } catch (e) {
    if (e.statusCode) {
      return next(new ErrorHandler(e.message, e.statusCode));
    }
    console.error("Gemini API error:", e?.message || e);
    return next(
      new ErrorHandler(
        e?.message || "Failed to get AI response. Check GEMINI_API_KEY and model availability.",
        502
      )
    );
  }
});

export { postAiChat };
