import type { ReelProps } from "../src/types";
import { bold } from "./bold";
import { minimal } from "./minimal";
import type { Theme } from "./shared";

export const THEMES: Record<ReelProps["style"]["theme"], Theme> = { bold, minimal };
