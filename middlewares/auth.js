import jwt from "jsonwebtoken";
import { ErrorHandler } from "../utils/utility.js";
import { adminSecretKey } from "../app.js";
import { TryCatch } from "./error.js";
import { CHATTU_TOKEN, CHATTU_ADMIN_TOKEN } from "../constants/config.js";
import { User } from "../models/user.js";

const readBearerToken = (req) => {
  const h = req.headers.authorization;
  if (typeof h === "string" && h.startsWith("Bearer ")) {
    return h.slice(7).trim();
  }
  return null;
};

const isAuthenticated = TryCatch((req, res, next) => {
  const token = readBearerToken(req) || req.cookies[CHATTU_TOKEN];
  if (!token)
    return next(new ErrorHandler("Please login to access this route", 401));

  let decodedData;
  try {
    decodedData = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(new ErrorHandler("Invalid or expired session", 401));
  }

  req.user = decodedData._id;

  next();
});

const adminOnly = (req, res, next) => {
  const token = req.cookies[CHATTU_ADMIN_TOKEN];

  if (!token)
    return next(new ErrorHandler("Only Admin can access this route", 401));

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (decoded.role !== "admin")
    return next(new ErrorHandler("Only Admin can access this route", 401));

  next();
};

const readSocketJwt = (socket) => {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.trim()) return fromAuth.trim();

  const h = socket.handshake.headers?.authorization;
  if (typeof h === "string" && h.startsWith("Bearer "))
    return h.slice(7).trim();

  return socket.request.cookies?.[CHATTU_TOKEN] || null;
};

const socketAuthenticator = async (err, socket, next) => {
  try {
    if (err) return next(err);

    const authToken = readSocketJwt(socket);

    if (!authToken)
      return next(new ErrorHandler("Please login to access this route", 401));

    let decodedData;
    try {
      decodedData = jwt.verify(authToken, process.env.JWT_SECRET);
    } catch {
      return next(new ErrorHandler("Invalid or expired session", 401));
    }

    const user = await User.findById(decodedData._id);

    if (!user)
      return next(new ErrorHandler("Please login to access this route", 401));

    socket.user = user;

    return next();
  } catch (error) {
    console.log(error);
    return next(new ErrorHandler("Please login to access this route", 401));
  }
};

export { isAuthenticated, adminOnly, socketAuthenticator };
