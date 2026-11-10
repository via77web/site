/** SOHEL Motion System v1, for code (Remotion, the recorder, audits). Mirrors motion.css. */
export const EASE = {
  draft: [0.65, 0, 0.35, 1],
  build: [0.16, 1, 0.3, 1],
  snap: [0.7, 0, 0.15, 1],
  press: [0.3, 1.4, 0.5, 1],
} as const;

export type EaseName = keyof typeof EASE;

export const DURATION_MS = { micro: 160, ui: 280, reveal: 640, scene: 900, draw: 1200, stagger: 60 } as const;

/** The cubic-bezier() strings a generated site is allowed to contain. */
export const ALLOWED_BEZIERS = Object.values(EASE).map((v) => `cubic-bezier(${v.join(",")})`);
