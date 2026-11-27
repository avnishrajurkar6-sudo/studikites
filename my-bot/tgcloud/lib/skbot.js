/* Shared helpers for the StudiKitEZ Telegram bot.
   Edit GROUP_ID / GROUP_INVITE to match your community group. The bot must be
   an administrator of that group so getChatMember can confirm membership. */
import { api, fetch } from "sdk";

export const GROUP_ID = "@studikitez";
export const GROUP_INVITE = "https://t.me/studikitez";
export const VERIFY_URL = "https://studikites.vercel.app/api/telegram/verify";
/* Optional: set the same value as TELEGRAM_BOT_SECRET in Vercel. Leave empty to
   rely on the single-use token alone. */
export const BOT_SECRET = "";

const MEMBER_STATES = ["creator", "administrator", "member", "restricted"];

export async function isMember(userId) {
  try {
    const member = await api.getChatMember({ chat_id: GROUP_ID, user_id: userId });
    return !!member && MEMBER_STATES.indexOf(member.status) >= 0 && member.is_member !== false;
  } catch (error) {
    console.error("getChatMember failed", error && (error.description || error.message));
    return null; /* unknown, not "not a member" */
  }
}

export function joinKeyboard(token) {
  const rows = [[{ text: "Join the group", url: GROUP_INVITE }]];
  rows.push([{ text: "I've joined — verify", callback_data: token ? "retry:" + token : "retry:" }]);
  return { inline_keyboard: rows };
}

export async function verifyToken(token, from) {
  if (!token) return { ok: false, reason: "missing" };
  try {
    const headers = { "Content-Type": "application/json" };
    if (BOT_SECRET) headers["x-sk-bot-secret"] = BOT_SECRET;
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        token,
        telegramUserId: String(from.id),
        username: from.username || "",
        firstName: from.first_name || "",
      }),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result && result.verified) return { ok: true };
    if (response.status === 404 || response.status === 410) return { ok: false, reason: "expired" };
    if (response.status === 409) return { ok: false, reason: "used" };
    return { ok: false, reason: "failed" };
  } catch (error) {
    console.error("verifyToken failed", error && error.message);
    return { ok: false, reason: "offline" };
  }
}

export function verifyMessage(result) {
  if (result.ok) return "✅ Telegram verified and linked to your StudiKitEZ account. You can return to the site now.";
  if (result.reason === "expired") return "⌛ This link has expired. Sign in to StudiKitEZ and tap “Verify with Telegram” again.";
  if (result.reason === "used") return "This link was already used. Request a fresh link from your StudiKitEZ account.";
  if (result.reason === "missing") return "Open the verification link from your signed-in StudiKitEZ account to link Telegram.";
  if (result.reason === "offline") return "Verification is temporarily unavailable. Please try again in a minute.";
  return "We couldn't verify this account. Request a fresh link from StudiKitEZ.";
}
