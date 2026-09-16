/** Node entry: sql.js DB + HTTP server glue exported for local-server.mjs */
export { handleApi, envFromVars } from "./api.js";
export {
  computeMmScore,
  scoreBand,
} from "./engines/score.js";
export { computeCapitalOperativoReal } from "./engines/capital.js";
export { computeProfit, rankByCapitalEfficiency } from "./engines/profit.js";
export { isHardSkipped } from "./engines/hardskip.js";
export { inventFlags, assertNoInventPolicy } from "./engines/invent.js";
export { classifyMatch } from "./engines/match.js";
export { buildQueHagoHoy } from "./engines/tasks.js";
