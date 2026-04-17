import express from "express";
import { googleAuth } from "../controllers/auth.js";
import { googleAuthValidator, validateHandler } from "../lib/validators.js";

const app = express.Router();

app.post("/google", googleAuthValidator(), validateHandler, googleAuth);

export default app;
