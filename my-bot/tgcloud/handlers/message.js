/* /start handler — membership gate + account linking.
   Flow:
   1. /start (optionally with ?start=skv1_<token>)
   2. If the learner is not in the community group, show Join + "I've joined".
   3. Once membership is confirmed, redeem the token and link the account. */
import { api } from "sdk";
import { isMember, joinKeyboard, verifyToken, verifyMessage } from "../lib/skbot.js";

const START = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/;

export default async function (message) {
  if (!message || !message.chat || message.chat.type !== "private" || !message.from || message.from.is_bot) return;
  const text = String(message.text || "").trim();
  if (!/^\/start\b/.test(text)) return;
  const match = text.match(START);
  const payload = (match && match[1]) || "";
  const token = /^skv1_[A-Za-z0-9_-]{43}$/.test(payload) ? payload.slice(5) : "";

  const member = await isMember(message.from.id);
  if (member !== true) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text:
        "👋 Welcome to StudiKitEZ!\n\n" +
        (member === null
          ? "I couldn't check the community group just now. Join the group, then tap the button below to retry."
          : "Join our community group first, then tap “I've joined — verify”."),
      reply_markup: joinKeyboard(token),
    });
    return;
  }

  if (!token) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: "✅ You're in the community group.\n\nTo link Telegram to your StudiKitEZ account, sign in on the site and tap “Verify with Telegram”.",
    });
    return;
  }

  const result = await verifyToken(token, message.from);
  await api.sendMessage({ chat_id: message.chat.id, text: verifyMessage(result) });
}
