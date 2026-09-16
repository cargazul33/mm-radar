import { HARD_SKIP_CODINEU_IDS } from "../constants.js";

/** Hard-skip CODINEU 16514 (y lista). Nunca entra como oportunidad accionable. */
export function isHardSkipped(externalId: string | number | null | undefined): boolean {
  if (externalId == null) return false;
  const id = String(externalId).replace(/\D/g, "") || String(externalId).trim();
  // Match bare id or id embedded like "CODINEU-16514"
  if (HARD_SKIP_CODINEU_IDS.has(id)) return true;
  for (const skip of HARD_SKIP_CODINEU_IDS) {
    if (String(externalId).includes(skip)) return true;
  }
  return false;
}

export function hardSkipReason(externalId: string | number): string {
  return `HARD_SKIP CODINEU ${externalId}: excluido permanentemente (política M&M)`;
}
