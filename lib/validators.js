import { body, param, query, validationResult } from "express-validator";
import { ErrorHandler } from "../utils/utility.js";

const validateHandler = (req, res, next) => {
  const errors = validationResult(req);

  const errorMessages = errors
    .array()
    .map((error) => error.msg)
    .join(", ");

  if (errors.isEmpty()) return next();
  else next(new ErrorHandler(errorMessages, 400));
};

const registerValidator = () => [
  body("name", "Please Enter Name").notEmpty(),
  body("email", "Please enter a valid email")
    .trim()
    .notEmpty()
    .isEmail()
    .normalizeEmail(),
  body("username", "Please Enter Username").notEmpty(),
  body("bio", "Please Enter Bio").notEmpty(),
  body("password", "Please Enter Password").notEmpty(),
];

const loginValidator = () => [
  body("username", "Please Enter Username").notEmpty(),
  body("password", "Please Enter Password").notEmpty(),
];

const newGroupValidator = () => [
  body("name", "Please Enter Name").notEmpty(),
  body("members")
    .notEmpty()
    .withMessage("Please Enter Members")
    .isArray({ min: 2, max: 100 })
    .withMessage("Members must be 2-100"),
];

const addMemberValidator = () => [
  body("chatId", "Please Enter Chat ID").notEmpty(),
  body("members")
    .notEmpty()
    .withMessage("Please Enter Members")
    .isArray({ min: 1, max: 97 })
    .withMessage("Members must be 1-97"),
];

const removeMemberValidator = () => [
  body("chatId", "Please Enter Chat ID").notEmpty(),
  body("userId", "Please Enter User ID").notEmpty(),
];

const sendAttachmentsValidator = () => [
  body("chatId", "Please Enter Chat ID").notEmpty(),
];

const chatIdValidator = () => [param("id", "Please Enter Chat ID").notEmpty()];

const forwardMessageValidator = () => [
  body("sourceMessageId", "Invalid message id").isMongoId(),
  body("targetChatId", "Invalid chat id").isMongoId(),
];

const renameValidator = () => [
  param("id", "Please Enter Chat ID").notEmpty(),
  body("name", "Please Enter New Name").notEmpty(),
];

const groupMessagingPermissionsValidator = () => [
  param("id", "Please Enter Chat ID").notEmpty(),
  body("onlyAdminsCanPost")
    .exists()
    .withMessage("onlyAdminsCanPost is required")
    .isBoolean()
    .withMessage("onlyAdminsCanPost must be true or false"),
];

const sendRequestValidator = () => [
  body("userId", "Please Enter User ID").notEmpty(),
];

const acceptRequestValidator = () => [
  body("requestId", "Please Enter Request ID").notEmpty(),
  body("accept")
    .notEmpty()
    .withMessage("Please Add Accept")
    .isBoolean()
    .withMessage("Accept must be a boolean"),
];

const adminLoginValidator = () => [
  body("secretKey", "Please Enter Secret Key").notEmpty(),
];

const messageIdParamValidator = () => [
  param("messageId", "Invalid message id").isMongoId(),
];

const editMessageValidator = () => [
  body("content", "Please enter message text")
    .trim()
    .notEmpty()
    .isLength({ max: 8000 })
    .withMessage("Message is too long"),
];

const deleteMessageQueryValidator = () => [
  query("mode", "mode must be forMe or forEveryone")
    .optional()
    .isIn(["forMe", "forEveryone"]),
];

const googleAuthValidator = () => [
  body("credential", "Google credential is required").notEmpty().isString(),
];

const forgotPasswordValidator = () => [
  body("email", "Please enter a valid email")
    .trim()
    .notEmpty()
    .isEmail()
    .normalizeEmail(),
];

const resetPasswordValidator = () => [
  body("token", "Reset token is required").notEmpty().isString(),
  body("password", "Please enter a new password")
    .notEmpty()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
];

const updateProfileValidator = () => [
  body("name")
    .optional({ values: "falsy" })
    .trim()
    .notEmpty()
    .withMessage("Name cannot be empty"),
  body("bio").optional().trim(),
  body("username")
    .optional({ values: "falsy" })
    .trim()
    .notEmpty()
    .withMessage("Username cannot be empty"),
  body("email")
    .optional({ values: "falsy" })
    .trim()
    .isEmail()
    .withMessage("Invalid email")
    .normalizeEmail(),
];

const changePasswordValidator = () => [
  body("currentPassword", "Current password is required").notEmpty(),
  body("newPassword", "New password must be at least 6 characters")
    .notEmpty()
    .isLength({ min: 6 }),
];

const adminUserIdParam = () => [
  param("userId", "Invalid user id").isMongoId(),
];

const adminChatIdParam = () => [
  param("chatId", "Invalid chat id").isMongoId(),
];

const adminMessageIdParam = () => [
  param("messageId", "Invalid message id").isMongoId(),
];

const adminUpdateUserValidator = () => [
  ...adminUserIdParam(),
  body("name").optional().trim().notEmpty().withMessage("Name cannot be empty"),
  body("bio").optional().trim(),
  body("username")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Username cannot be empty"),
  body("email").optional({ values: "falsy" }).trim().isEmail().normalizeEmail(),
];

const adminSetUserPasswordValidator = () => [
  ...adminUserIdParam(),
  body("newPassword", "Password must be at least 6 characters")
    .notEmpty()
    .isLength({ min: 6 }),
];

const pinChatValidator = () => [
  body("chatId", "Please Enter Chat ID").notEmpty().isMongoId(),
];

export {
  acceptRequestValidator,
  addMemberValidator,
  adminLoginValidator,
  adminUserIdParam,
  adminChatIdParam,
  adminMessageIdParam,
  adminUpdateUserValidator,
  adminSetUserPasswordValidator,
  changePasswordValidator,
  chatIdValidator,
  loginValidator,
  messageIdParamValidator,
  editMessageValidator,
  deleteMessageQueryValidator,
  googleAuthValidator,
  forgotPasswordValidator,
  forwardMessageValidator,
  groupMessagingPermissionsValidator,
  pinChatValidator,
  resetPasswordValidator,
  updateProfileValidator,
  newGroupValidator,
  registerValidator,
  removeMemberValidator,
  renameValidator,
  sendAttachmentsValidator,
  sendRequestValidator,
  validateHandler,
};
