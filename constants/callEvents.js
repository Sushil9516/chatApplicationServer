/** Socket.io signaling for WebRTC (1-to-1). Event names are fixed for client/server parity. */
export const CALL_USER = "call-user";
export const INCOMING_CALL = "incoming-call";
export const ACCEPT_CALL = "accept-call";
export const REJECT_CALL = "reject-call";
export const OFFER = "offer";
export const ANSWER = "answer";
export const ICE_CANDIDATE = "ice-candidate";
export const END_CALL = "end-call";
export const CALL_ERROR = "call-error";
