import { api, fetch } from "sdk";

const VERIFY_URL = "https://studikites.vercel.app/api/auth/telegram-link";

export default async function (message) {
  if (!message || !message.chat || message.chat.type !== "private" || !message.from || message.from.is_bot) return;
  const text = String(message.text || "").trim();
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/);
  if (!match) return;

  const payload = match[1] || "";
  if (!/^skv1_[A-Za-z0-9_-]{43}$/.test(payload)) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: "To verify your account, open the Telegram verification link from your signed-in StudiKitEZ account.",
    });
    return;
  }

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "verify",
        token: payload.slice(5),
        telegramUserId: String(message.from.id),
        username: message.from.username || "",
        firstName: message.from.first_name || "",
      }),
    });
    const result = await response.json().catch(() => null);
    let reply;
    if (response.ok && result && result.verified) {
      reply = "Telegram is verified and linked to your StudiKitEZ account.";
    } else if (response.status === 404 || response.status === 410) {
      reply = "This verification link has expired. Sign in to StudiKitEZ and request a new one.";
    } else if (response.status === 409) {
      reply = "This verification link has already been used. Request a new link from StudiKitEZ.";
    } else {
      reply = "We could not verify this account. Sign in to StudiKitEZ and request a new link.";
    }
    await api.sendMessage({ chat_id: message.chat.id, text: reply });
  } catch (error) {
    console.error("Telegram account verification failed", error);
    await api.sendMessage({
      chat_id: message.chat.id,
      text: "Verification is temporarily unavailable. Please try again later.",
    });
  }
}
