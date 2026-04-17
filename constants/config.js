const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    process.env.CLIENT_URL || "https://chat-application-client-theta.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};

/** Cookie names — unchanged from original app; product UI name is separate. */
const CHATTU_TOKEN = "chattu-token";
const CHATTU_ADMIN_TOKEN = "chattu-admin-token";

export { corsOptions, CHATTU_TOKEN, CHATTU_ADMIN_TOKEN };
