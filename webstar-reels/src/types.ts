export type SiteStatus = "pending" | "posted" | "failed";

export interface Site {
  url: string;
  name: string;
  niche: string;
  status: SiteStatus;
  day?: number;
  attempts?: number;
  lastError?: string;
  scheduledFor?: string;
  postedAt?: string;
  videoUrl?: string;
  /** Buffer post id per channel id. Lets a retry skip channels that already succeeded. */
  posts?: Record<string, string>;
}

export interface ReelScript {
  hook: string;
  voiceover: string;
  captions: string[];
  cta: string;
  postCaption: string;
  hashtags: string[];
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface PageInfo {
  title: string;
  description: string;
  headings: string[];
}

/** Input props of the Remotion composition. Asset paths are relative to public/. */
export type ReelProps = {
  recordingSrc: string;
  recordingDuration: number;
  voiceSrc: string;
  voiceDuration: number;
  musicSrc: string | null;
  logoSrc: string | null;
  hook: string;
  captions: string[];
  words: WordTiming[];
  cta: string;
};
