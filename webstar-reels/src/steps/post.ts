import { pathToFileURL } from "node:url";
import { brandEnv, brandEnvName, loadBrand, type Brand } from "../lib/brand.js";
import { env, requireEnv } from "../lib/env.js";

const BUFFER_API = "https://api.buffer.com";

type Service = "instagram" | "tiktok" | string;

export interface Channel {
  id: string;
  service: Service;
}

/** A brand can use its own Buffer account via BUFFER_ACCESS_TOKEN_<BRAND>; otherwise the shared token. */
export function bufferToken(brand: Brand): string | undefined {
  return brandEnv("BUFFER_ACCESS_TOKEN", brand) ?? env("BUFFER_ACCESS_TOKEN");
}

async function buffer<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!res.ok || !body || body.errors?.length) {
    const detail = body?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(`Buffer API error: ${detail}`);
  }
  return body.data as T;
}

/** All channels on the Buffer account, for finding the IDs to put in BUFFER_PROFILE_IDS_<BRAND>. */
export async function listChannels(token: string): Promise<(Channel & { name: string })[]> {
  const orgs = await buffer<{ account: { organizations: { id: string }[] } }>(
    token,
    `query { account { organizations { id } } }`,
  );
  const channels: (Channel & { name: string })[] = [];
  for (const org of orgs.account.organizations) {
    const data = await buffer<{ channels: (Channel & { name: string })[] }>(
      token,
      `query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }`,
      { input: { organizationId: org.id } },
    );
    channels.push(...data.channels);
  }
  return channels;
}

/**
 * BUFFER_PROFILE_IDS_<BRAND> is a comma-separated list of channel IDs. An entry may carry
 * its service ("instagram:abc123"); otherwise the service is looked up from the account.
 * There is deliberately no shared fallback, so one brand can never post to another's accounts.
 */
export async function resolveChannels(brand: Brand): Promise<Channel[]> {
  const name = brandEnvName("BUFFER_PROFILE_IDS", brand);
  const entries = (env(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!entries.length) throw new Error(`${name} is empty`);
  const parsed = entries.map((entry) => {
    const [a, b] = entry.split(":");
    return b ? { id: b.trim(), service: a.trim().toLowerCase() } : { id: a, service: "" };
  });
  if (parsed.every((c) => c.service)) return parsed;
  const known = await listChannels(bufferToken(brand)!);
  return parsed.map((c) => {
    if (c.service) return c;
    const match = known.find((k) => k.id === c.id);
    if (!match) throw new Error(`Buffer channel ${c.id} was not found on this account`);
    return { id: c.id, service: match.service.toLowerCase() };
  });
}

/** Schedule a reel on one channel (Instagram Reels, TikTok or YouTube Shorts). Returns the Buffer post id. */
export async function schedulePost(
  brand: Brand,
  channel: Channel,
  post: { text: string; videoUrl: string; dueAt: Date; youtubeTitle: string },
): Promise<string> {
  const input: Record<string, unknown> = {
    channelId: channel.id,
    text: post.text,
    schedulingType: "automatic", // Buffer publishes it for you, no phone notification
    mode: "customScheduled",
    dueAt: post.dueAt.toISOString(),
    assets: { videos: [{ url: post.videoUrl }] },
  };
  if (channel.service === "instagram") {
    input.metadata = { instagram: { type: "reel", shouldShareToFeed: true } };
  } else if (channel.service === "youtube") {
    // Vertical and under three minutes, so YouTube files it as a Short. 22 = People & Blogs.
    input.metadata = { youtube: { title: post.youtubeTitle.slice(0, 100), categoryId: "22" } };
  }
  const data = await buffer<{
    createPost: { post?: { id: string }; message?: string };
  }>(
    bufferToken(brand)!,
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    { input },
  );
  const id = data.createPost.post?.id;
  if (!id) throw new Error(`Buffer rejected the ${channel.service} post: ${data.createPost.message ?? "unknown error"}`);
  return id;
}

export interface Metrics {
  views?: number;
  watchSeconds?: number;
  shares?: number;
  reactions?: number;
  comments?: number;
}

/** Sort Buffer's metric names into the few the learning loop uses. Names vary by network. */
export function readMetrics(list: { type?: string | null; name?: string | null; value?: number | string | null; unit?: string | null }[]): Metrics {
  const out: Metrics = {};
  const add = (k: keyof Metrics, v: number) => (out[k] = Math.max(out[k] ?? 0, v));
  for (const m of list) {
    const label = `${m.type ?? ""} ${m.name ?? ""}`.toLowerCase();
    let value = Number(m.value);
    if (!Number.isFinite(value)) continue;
    if (/watch|view.?time|play.?time|duration/.test(label)) {
      if (/min/.test(`${m.unit ?? ""} ${label}`)) value *= 60;
      else if (/hour/.test(`${m.unit ?? ""} ${label}`)) value *= 3600;
      else if (/ms|millisecond/.test(`${m.unit ?? ""}`)) value /= 1000;
      add("watchSeconds", value);
    } else if (/view|play|impression|reach/.test(label)) add("views", value);
    else if (/share|repost|retweet/.test(label)) add("shares", value);
    else if (/comment|repl/.test(label)) add("comments", value);
    else if (/reaction|like|favou?rite/.test(label)) add("reactions", value);
  }
  return out;
}

/** Performance of one scheduled post, from Buffer's post metrics. */
export async function postMetrics(brand: Brand, postId: string): Promise<Metrics> {
  const data = await buffer<{ post: { metrics: { type: string; name: string; value: number; unit: string }[] | null } | null }>(
    bufferToken(brand)!,
    `query PostMetrics($input: PostInput!) { post(input: $input) { metrics { type name value unit } metricsUpdatedAt } }`,
    { input: { id: postId } },
  );
  return readMetrics(data.post?.metrics ?? []);
}

// `npm run buffer:channels` (add `-- --brand via77` to use that brand's own Buffer token)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--list-channels")) {
  const brandFlag = process.argv.indexOf("--brand");
  const token = brandFlag > -1 ? bufferToken(loadBrand(process.argv[brandFlag + 1])) : env("BUFFER_ACCESS_TOKEN");
  if (!token) requireEnv(["BUFFER_ACCESS_TOKEN"]);
  const channels = await listChannels(token!);
  for (const c of channels) console.log(`${c.service}:${c.id}  ${c.name}`);
  if (!channels.length) console.log("No channels found on this Buffer account.");
}
