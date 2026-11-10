/** npm run learn [-- --brand via77]: gather results and rewrite insights.md now. The Sunday job does this before it builds. */
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { startLog } from "../lib/log.js";
import { learn } from "../learn.js";

const { values: flags } = parseArgs({ options: { brand: { type: "string" } } });
startLog("learn");
for (const id of flags.brand ? flags.brand.split(",") : listBrandIds()) await learn(loadBrand(id.trim()));
