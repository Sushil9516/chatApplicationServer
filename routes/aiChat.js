import express from "express";
import { isAuthenticated } from "../middlewares/auth.js";
import { postAiChat } from "../controllers/aiChat.js";

const router = express.Router();

router.use(isAuthenticated);
router.post("/", postAiChat);

export default router;
