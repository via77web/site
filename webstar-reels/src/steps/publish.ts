import path from "node:path";
import { brandEnv, brandEnvName, type Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";

/**
 * Buffer downloads the video from a URL, so the MP4 has to be publicly reachable.
 * Uses VIDEO_PUBLIC_URL_<BRAND> if set; otherwise, inside GitHub Actions, uploads the file to
 * a GitHub Release on this repo (public repos only) and returns its download URL.
 */
export async function publishVideo(file: string, tag: string, brand: Brand): Promise<string> {
  const preset = brandEnv("VIDEO_PUBLIC_URL", brand);
  if (preset) return preset;

  const repo = env("GITHUB_REPOSITORY");
  if (!repo || !(env("GH_TOKEN") ?? env("GITHUB_TOKEN"))) {
    throw new Error(
      `No public URL for the video. Set ${brandEnvName("VIDEO_PUBLIC_URL", brand)}, or run in GitHub Actions where the reel is uploaded to a GitHub Release.`,
    );
  }
  const exists = await run("gh", ["release", "view", tag, "--repo", repo]).then(() => true, () => false);
  if (exists) {
    await run("gh", ["release", "upload", tag, file, "--clobber", "--repo", repo]);
  } else {
    await run("gh", ["release", "create", tag, file, "--repo", repo, "--title", tag, "--notes", "Daily reel"]);
  }
  const url = `https://github.com/${repo}/releases/download/${tag}/${path.basename(file)}`;

  const check = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (!check.ok) {
    throw new Error(
      `Uploaded the reel to ${url} but it is not publicly downloadable (HTTP ${check.status}). Release files are only public on a public repository; make the repo public or set ${brandEnvName("VIDEO_PUBLIC_URL", brand)}.`,
    );
  }
  return url;
}
