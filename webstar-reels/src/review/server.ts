import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT, listBrandIds, loadBrand } from "../lib/brand.js";
import { loadBatches, saveBatch } from "../lib/batches.js";
import { loadCalendar, localDate } from "../lib/calendar.js";
import { log, logError } from "../lib/log.js";
import { picksFor, propose } from "../plan.js";
import { scheduleApproved } from "../schedule.js";
import { VARIANT_LABEL, type Batch, type BatchVariant } from "../types.js";

export const REVIEW_PORT = Number(process.env.REVIEW_PORT ?? 4777);

interface Item {
  brand: string;
  batch: Batch;
  variant: BatchVariant;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function items(today: string): { decide: Item[]; done: Item[]; spare: Item[] } {
  const all: Item[] = listBrandIds().flatMap((brand) =>
    loadBatches({ id: brand }).flatMap((batch) => batch.variants.map((variant) => ({ brand, batch, variant }))),
  );
  return {
    decide: all.filter((i) => i.variant.status === "awaiting"),
    done: all.filter((i) => i.variant.proposedOn === today && i.variant.status !== "awaiting" && i.variant.status !== "ready"),
    spare: all.filter((i) => i.variant.status === "ready" && !i.variant.plannedFor).slice(-12),
  };
}

function card(i: Item, actions: string): string {
  const v = i.variant;
  const s = v.script;
  const when = v.scheduledFor
    ? new Date(v.scheduledFor).toLocaleString("en-AU", { timeZone: loadCalendar().timezone, weekday: "short", hour: "numeric", minute: "2-digit" })
    : "";
  const status =
    v.status === "scheduled" ? `Scheduled for ${esc(when)}` : v.status === "approved" ? `Approved${v.error ? `, not scheduled yet: ${esc(v.error)}` : ", scheduling…"}` : v.status === "rejected" ? "Rejected" : "";
  const audit = i.batch.audit?.blocking.length ? `<p class="warn">Audit: ${i.batch.audit.blocking.length} blocking issue(s): ${esc(i.batch.audit.blocking[0])}</p>` : "";
  return `<article class="card ${v.status}">
  <video src="/video/${esc(i.brand)}/${esc(i.batch.id)}/${esc(v.id)}" controls playsinline preload="metadata"></video>
  <div class="meta">
    <p class="eyebrow">${esc(i.brand.toUpperCase())} · ${esc(VARIANT_LABEL[v.id])} · ${v.seconds.toFixed(1)}s</p>
    <h2>${esc(i.batch.site.name)}</h2>
    <p class="hook">“${esc(s.hook)}”</p>
    <p class="caption">${esc(v.postText).replace(/\n/g, "<br>")}</p>
    <p class="small">YouTube: ${esc(s.youtubeTitle)}${i.batch.site.previewUrl ? ` · <a href="${esc(i.batch.site.previewUrl)}" target="_blank">site preview</a>` : ""}</p>
    ${audit}
    ${status ? `<p class="status${v.error ? " warn" : ""}">${status}</p>` : ""}
    <div class="actions">${actions}</div>
  </div>
</article>`;
}

const button = (i: Item, action: string, label: string, kind = "") =>
  `<button class="${kind}" data-brand="${esc(i.brand)}" data-batch="${esc(i.batch.id)}" data-variant="${esc(i.variant.id)}" data-action="${action}">${label}</button>`;

function page(today: string, deadline?: Date): string {
  const { decide, done, spare } = items(today);
  const tz = loadCalendar().timezone;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reels to approve</title>
<style>
:root{--bg:#f4f2ee;--ink:#17181a;--muted:#6b6a66;--line:#d9d6cf;--ok:#1f7a4d;--no:#a33;--accent:#e8793a}
@media (prefers-color-scheme:dark){:root{--bg:#141516;--ink:#efede8;--muted:#a3a29d;--line:#2c2d2f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 18px 80px}h1{font-size:28px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 24px}
.card{display:grid;grid-template-columns:minmax(0,270px) 1fr;gap:22px;padding:20px 0;border-top:1px solid var(--line)}
.card.rejected{opacity:.45}video{width:100%;aspect-ratio:9/16;background:#000;border-radius:10px}
.eyebrow{font-size:12px;letter-spacing:.08em;color:var(--muted);margin:0}h2{margin:2px 0 8px;font-size:22px}
.hook{font-size:18px;font-weight:600;margin:0 0 10px}.caption{margin:0 0 10px}.small{font-size:13px;color:var(--muted)}
.status{font-weight:600;color:var(--ok)}.warn,.status.warn{color:var(--no)}.rejected .status{color:var(--no)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
button{font:inherit;min-height:44px;padding:0 18px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
button.yes{background:var(--ok);border-color:var(--ok);color:#fff}button.no{color:var(--no);border-color:var(--no)}
button:disabled{opacity:.5;cursor:wait}.bar{display:flex;gap:10px;margin:0 0 10px}
details{margin-top:30px}summary{cursor:pointer;color:var(--muted)}
@media (max-width:640px){.card{grid-template-columns:1fr}video{max-width:300px}}
</style></head><body><main>
<h1>${decide.length ? `${decide.length} reel${decide.length > 1 ? "s" : ""} to approve` : "Nothing waiting"}</h1>
<p class="sub">${esc(today)}${deadline ? ` · decide by ${esc(deadline.toLocaleTimeString("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit" }))}; anything undecided won't post` : ""}. Approved reels go to Buffer at the next calendar slot.</p>
${decide.length > 1 ? `<div class="bar"><button class="yes" data-action="approve-all">Approve all</button></div>` : ""}
${decide.map((i) => card(i, `${button(i, "approve", "Approve", "yes")}${button(i, "swap", "Swap for another")}${button(i, "reject", "Reject", "no")}`)).join("")}
${done.length ? `<h2 style="margin-top:34px">Decided today</h2>${done.map((i) => card(i, "")).join("")}` : ""}
${spare.length ? `<details><summary>Other ready reels (${spare.length}), e.g. from npm run make</summary>${spare.map((i) => card(i, button(i, "approve", "Approve", "yes"))).join("")}</details>` : ""}
</main><script>
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-action]"); if (!b) return;
  document.querySelectorAll("button").forEach((x) => (x.disabled = true));
  const res = await fetch("/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b.dataset) });
  if (!res.ok) alert(await res.text());
  location.reload();
});
</script></body></html>`;
}

function streamVideo(file: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const size = fs.statSync(file).size;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "content-type": "video/mp4", "content-length": size, "accept-ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  }
}

/** Apply one decision. Approving uploads the reel and schedules it straight away. */
export async function decide(brandId: string, batchId: string, variantId: string, action: string, today: string): Promise<string> {
  const brand = loadBrand(brandId);
  const batch = loadBatches(brand).find((b) => b.id === batchId);
  const variant = batch?.variants.find((v) => v.id === variantId);
  if (!batch || !variant) throw new Error("Reel not found");
  if (action === "approve") {
    variant.status = "approved";
    variant.proposedOn ??= today;
    saveBatch(batch);
    log(`approved ${batch.id} ${variant.id}`);
    await scheduleApproved(brand);
    return "approved";
  }
  if (action === "reject" || action === "swap") {
    variant.status = "rejected";
    saveBatch(batch);
    log(`${action === "swap" ? "swapped out" : "rejected"} ${batch.id} ${variant.id}`);
    if (action === "swap") {
      const [next] = picksFor(brand, today, 1, new Set([batch.id]));
      if (!next) return "rejected; no other ready reel to offer";
      propose([next], today);
      return `offered ${next.batch.id} ${next.variant.id} instead`;
    }
    return "rejected";
  }
  throw new Error(`Unknown action ${action}`);
}

/** The approval page on http://localhost:<port>. Decisions take effect immediately. */
export async function startReviewServer(opts: { deadline?: Date } = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const today = () => localDate(new Date(), loadCalendar().timezone);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(today(), opts.deadline));
      } else if (req.method === "GET" && url.pathname.startsWith("/video/")) {
        const [, , brand, batchId, variantId] = url.pathname.split("/").map(decodeURIComponent);
        const v = loadBatches({ id: brand }).find((b) => b.id === batchId)?.variants.find((x) => x.id === variantId);
        const file = v && path.join(ROOT, v.file);
        if (!file || !file.startsWith(path.join(ROOT, "out")) || !fs.existsSync(file)) res.writeHead(404).end("Video not found");
        else streamVideo(file, req, res);
      } else if (req.method === "POST" && url.pathname === "/decide") {
        const body = JSON.parse(await new Promise<string>((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); }));
        if (body.action === "approve-all") {
          for (const i of items(today()).decide) await decide(i.brand, i.batch.id, i.variant.id, "approve", today());
          res.writeHead(200).end("ok");
        } else {
          res.writeHead(200).end(await decide(body.brand, body.batch, body.variant, body.action, today()));
        }
      } else {
        res.writeHead(404).end();
      }
    } catch (error) {
      logError(`review page: ${error instanceof Error ? error.message : error}`);
      if (!res.headersSent) res.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Localhost only: nobody else on the network can approve.
    server.listen(REVIEW_PORT, "127.0.0.1", resolve);
  });
  return { url: `http://localhost:${REVIEW_PORT}/`, close: () => new Promise((r) => server.close(() => r())) };
}

/** Variants still awaiting a decision, across brands. */
export function awaitingCount(): number {
  return items(localDate(new Date(), loadCalendar().timezone)).decide.length;
}
