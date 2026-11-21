/** Telegram alerts + daily summary (SPEC § 8). Without secrets (tests, CI) messages go to the log only. */

interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const MAX_LEN = 4000; // Telegram limit is 4096 chars

export async function notify(env: TelegramEnv, text: string, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<void> {
  const body = text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}…` : text;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log(JSON.stringify({ message: "telegram disabled, notification logged", text: body }));
    return;
  }
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: body, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(JSON.stringify({ message: "telegram send failed", status: res.status, body: (await res.text()).slice(0, 200) }));
  } catch (e) {
    // Alerts must never break the pipeline.
    console.error(JSON.stringify({ message: "telegram send error", error: e instanceof Error ? e.message : String(e) }));
  }
}
