/** npm run review: open the approval page now (for reels from `make`, or if you missed the morning). Ctrl-C to stop. */
import { spawn } from "node:child_process";
import { startLog } from "../lib/log.js";
import { startReviewServer } from "../review/server.js";

startLog("review");
const server = await startReviewServer();
console.log(`Approval page: ${server.url}  (Ctrl-C to stop)`);
if (process.platform === "darwin") spawn("open", [server.url]);
