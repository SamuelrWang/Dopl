"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.failureDetail = failureDetail;
const narration_1 = require("./narration");
function errorMessage(e) {
    if (e && typeof e === "object" && "message" in e) {
        return String(e.message);
    }
    return String(e);
}
/**
 * Upstream failure text as a VALUE — same rule as the channel await's. ⚠ "It came from our own
 * server" says where the bytes were copied from, not who wrote them — a 4xx can echo a rejected
 * field, and the fields here are member-typed. The one copy behind `chats-render.ts` and
 * `skills-shared.ts`, which both re-export it (cleanup M04).
 */
function failureDetail(e) {
    return (0, narration_1.inlineOr)(errorMessage(e), "`no detail reported`");
}
