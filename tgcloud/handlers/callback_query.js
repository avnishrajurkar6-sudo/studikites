/* callback_query handler — “I've joined — verify” button.
   Re-checks group membership, then redeems the pending token. */
import { api } from "sdk";
import { isMember, joinKeyboard, verifyToken, verifyMessage } from "../lib/skbot.js";

export default async function (query) {
  if (!query || !query.from || !query.message) return;
  const data = String(query.data || "");
  if (data.indexOf("retry:") !== 0) {
    await api.answerCallbackQuery({ callback_query_id: query.id }).catch(() => {});
    return;
  }
  const token = data.slice(6);

  const member = await isMember(query.from.id);
  if (member !== true) {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: member === null ? "Couldn't check membership — try again." : "Join the group first, then retry.",
      show_alert: true,
    }).catch(() => {});
    await api.sendMessage({
      chat_id: query.message.chat.id,
      text: "You're not in the community group yet. Join it, then tap the button again.",
      reply_markup: joinKeyboard(token),
    }).catch(() => {});
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: query.id, text: "Checking…" }).catch(() => {});
  const result = await verifyToken(token, query.from);
  const text = verifyMessage(result);
  await api.sendMessage({ chat_id: query.message.chat.id, text }).catch(() => {});
}
