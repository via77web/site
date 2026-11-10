import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";
import { githubRepo } from "./publish.js";
import { VARIANT_LABEL, type Batch } from "../types.js";

export const REVIEW_LABEL = "reel-review";

const HOW_TO = `Reply with one of:

- \`/approve all\`
- \`/approve full detail\` (any of: full, detail, before-after, interaction; the rest are rejected)
- \`/reject\`

Approved reels are scheduled into the next free calendar slots. Nothing posts until you approve.`;

function markdown(batch: Batch): string {
  const audit = batch.audit
    ? batch.audit.blocking.length
      ? `**Audit: ${batch.audit.blocking.length} blocking issue(s) remain.** Check before approving:\n${batch.audit.blocking.map((x) => `- ${x}`).join("\n")}`
      : `Audit passed${batch.audit.warnings.length ? ` with ${batch.audit.warnings.length} warning(s)` : ""}.`
    : "";
  const warnings = batch.audit?.warnings.length
    ? `\n<details><summary>Audit warnings</summary>\n\n${batch.audit.warnings.map((x) => `- ${x}`).join("\n")}\n</details>`
    : "";
  return `**${batch.site.name}** for ${batch.brand.toUpperCase()}${batch.site.concept ? " (concept)" : ""}${batch.campaign ? `, campaign: ${batch.campaign}` : ""}

- Site: ${batch.site.previewUrl ?? batch.site.url}${batch.site.brief ? `\n- Brief: ${batch.site.brief}` : ""}${batch.site.direction ? `\n- Design direction: ${batch.site.direction}` : ""}
- Batch: \`${batch.id}\`

${audit}${warnings}

${batch.variants
  .map(
    (v) => `### ${VARIANT_LABEL[v.id]} (\`${v.id}\`, ${v.seconds.toFixed(1)}s)
${v.videoUrl ? `[Watch the reel](${v.videoUrl})` : `Local file: \`${v.file}\``}

> ${v.script.hook}

${v.postText.replace(/\n/g, "  \n")}

YouTube title: ${v.script.youtubeTitle}`,
  )
  .join("\n\n")}

---
${HOW_TO}`;
}

function htmlEmail(batch: Batch, issueUrl?: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const link = (url: string, text: string) => `<a href="${esc(url)}">${esc(text)}</a>`;
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;max-width:620px">
<h2 style="margin:0 0 8px">${esc(batch.site.name)}: ${batch.variants.length} reels to review</h2>
<p style="margin:0 0 16px;color:#555">${esc(batch.brand.toUpperCase())}${batch.site.concept ? " · concept" : ""}${batch.campaign ? ` · ${esc(batch.campaign)}` : ""}</p>
<p>${link(batch.site.previewUrl ?? batch.site.url, "Open the site")}${batch.audit?.blocking.length ? ` · <b style="color:#a33">${batch.audit.blocking.length} audit issue(s)</b>` : ""}</p>
${batch.variants
  .map(
    (v) => `<div style="border-top:1px solid #ddd;padding:12px 0">
<b>${esc(VARIANT_LABEL[v.id])}</b> · ${v.videoUrl ? link(v.videoUrl, "watch") : esc(v.file)}<br>
<i>${esc(v.script.hook)}</i><br><span style="color:#555">${esc(v.postText).replace(/\n/g, "<br>")}</span></div>`,
  )
  .join("")}
<p style="margin-top:20px">${issueUrl ? `Approve or reject in ${link(issueUrl, "the review issue")} by commenting <code>/approve all</code>, <code>/approve full detail</code> or <code>/reject</code>.` : `Run <code>npm run approve -- ${esc(batch.id)} all</code> (or list variants, or <code>reject</code>).`}</p>
<p style="color:#777">Nothing posts until you approve.</p></div>`;
}

/**
 * Ask for approval. Opens a GitHub issue when running with GitHub (GitHub emails and notifies
 * you about it), and also sends an email through Resend when RESEND_API_KEY and NOTIFY_EMAIL are set.
 * Returns the issue number, if one was opened.
 */
export async function requestApproval(batch: Batch): Promise<number | undefined> {
  let issue: number | undefined;
  let issueUrl: string | undefined;
  const repo = githubRepo();
  if (repo) {
    await run("gh", ["label", "create", REVIEW_LABEL, "--repo", repo, "--color", "FBCA04", "--description", "Reels waiting for approval"]).catch(() => {});
    const title = `Review: ${batch.brand.toUpperCase()} · ${batch.site.name} (${batch.variants.length} reels)`;
    const out = await run("gh", ["issue", "create", "--repo", repo, "--title", title, "--label", REVIEW_LABEL, "--body-file", "-"], Buffer.from(markdown(batch)));
    issueUrl = out.trim().split("\n").pop();
    issue = Number(issueUrl?.match(/\/issues\/(\d+)/)?.[1]) || undefined;
  }

  const apiKey = env("RESEND_API_KEY");
  const to = env("NOTIFY_EMAIL");
  if (apiKey && to) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env("NOTIFY_FROM") ?? "Reels <onboarding@resend.dev>",
        to: to.split(",").map((s) => s.trim()),
        subject: `Approve reels: ${batch.brand.toUpperCase()} · ${batch.site.name}`,
        html: htmlEmail(batch, issueUrl),
      }),
    });
    if (!res.ok) console.warn(`   email not sent: Resend returned ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  if (!issue && !(apiKey && to)) {
    console.log("\n" + markdown(batch) + "\n");
  }
  return issue;
}

/** Comment on and close the review issue once decided. */
export async function closeReview(batch: Batch, summary: string): Promise<void> {
  const repo = githubRepo();
  if (!repo || !batch.issue) return;
  await run("gh", ["issue", "comment", String(batch.issue), "--repo", repo, "--body-file", "-"], Buffer.from(summary));
  await run("gh", ["issue", "close", String(batch.issue), "--repo", repo]);
}
