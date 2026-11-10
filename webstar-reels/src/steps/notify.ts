import { spawnSync } from "node:child_process";
import { env } from "../lib/env.js";

/**
 * Notifications on the Mac, with optional copies to email (Resend) and phone (ntfy).
 *
 * - macOS: Notification Center. With terminal-notifier installed (brew install terminal-notifier)
 *   clicking the notification opens the review page; otherwise it's a plain banner.
 * - Email: RESEND_API_KEY + NOTIFY_EMAIL (+ NOTIFY_FROM).
 * - Phone: NTFY_TOPIC, using the ntfy app (ntfy.sh). Note the review page itself only opens on the Mac.
 */
export interface Notice {
  title: string;
  message: string;
  /** Opened when the notification is clicked. */
  url?: string;
  /** Longer body for email. */
  html?: string;
  urgent?: boolean;
}

const has = (cmd: string) => spawnSync("/usr/bin/which", [cmd]).status === 0;

function macNotification(n: Notice): void {
  if (process.platform !== "darwin") return;
  if (has("terminal-notifier")) {
    const args = ["-title", n.title, "-message", n.message, "-group", "webstar-reels", "-sound", n.urgent ? "Basso" : "Glass"];
    if (n.url) args.push("-open", n.url);
    spawnSync("terminal-notifier", args);
    return;
  }
  const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  spawnSync("osascript", ["-e", `display notification "${q(n.message)}" with title "${q(n.title)}" sound name "${n.urgent ? "Basso" : "Glass"}"`]);
}

async function email(n: Notice): Promise<void> {
  const key = env("RESEND_API_KEY");
  const to = env("NOTIFY_EMAIL");
  if (!key || !to) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("NOTIFY_FROM") ?? "Reels <onboarding@resend.dev>",
      to: to.split(",").map((s) => s.trim()),
      subject: n.title,
      html: n.html ?? `<p>${n.message.replace(/</g, "&lt;")}</p>${n.url ? `<p><a href="${n.url}">Open</a></p>` : ""}`,
    }),
  });
  if (!res.ok) console.warn(`email not sent: Resend returned ${res.status}`);
}

async function phone(n: Notice): Promise<void> {
  const topic = env("NTFY_TOPIC");
  if (!topic) return;
  const res = await fetch(`${env("NTFY_SERVER") ?? "https://ntfy.sh"}/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      // Header values must be ASCII; the title is kept plain.
      title: n.title.replace(/[^\x20-\x7e]/g, "-"),
      priority: n.urgent ? "high" : "default",
      tags: n.urgent ? "warning" : "clapper",
    },
    body: n.message,
  });
  if (!res.ok) console.warn(`phone notification not sent: ntfy returned ${res.status}`);
}

export async function notify(n: Notice): Promise<void> {
  macNotification(n);
  await Promise.allSettled([email(n), phone(n)]);
}
