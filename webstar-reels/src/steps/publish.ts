import path from "node:path";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";

export function githubRepo(): string | undefined {
  // The gh CLI uses its own login (gh auth login), so only the repo name is needed.
  return env("GITHUB_REPOSITORY");
}

/**
 * Buffer downloads videos from a URL, and the approval message links to them, so each reel
 * is uploaded to a GitHub Release named after its batch (one release, four files). Release
 * files are only publicly downloadable on a public repository.
 *
 * Needs GITHUB_REPOSITORY=owner/repo and the gh CLI logged in (gh auth login).
 */
export async function publishVideos(files: string[], tag: string, notes: string): Promise<string[]> {
  const repo = githubRepo();
  if (!repo) {
    throw new Error(
      "No place to host the videos. Set GITHUB_REPOSITORY=owner/repo in .env and log in with `gh auth login`; reels are uploaded to a GitHub Release when approved.",
    );
  }
  const exists = await run("gh", ["release", "view", tag, "--repo", repo]).then(() => true, () => false);
  if (!exists) {
    await run("gh", ["release", "create", tag, "--repo", repo, "--title", tag, "--notes", notes, "--prerelease"]);
  }
  await run("gh", ["release", "upload", tag, ...files, "--clobber", "--repo", repo]);

  const urls = files.map((f) => `https://github.com/${repo}/releases/download/${tag}/${path.basename(f)}`);
  const check = await fetch(urls[0], { method: "HEAD", redirect: "follow" });
  if (!check.ok) {
    throw new Error(
      `Uploaded the reels to the ${tag} release but they are not publicly downloadable (HTTP ${check.status}). Release files are only public on a public repository.`,
    );
  }
  return urls;
}
