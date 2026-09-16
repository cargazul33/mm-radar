import { APP_TZ } from "./constants.js";

/** Hours until ISO/local datetime string; null if unparseable. */
export function hoursUntil(dateStr: string | null | undefined, now = new Date()): number | null {
  if (!dateStr) return null;
  const parsed = parseFlexibleDate(dateStr);
  if (!parsed) return null;
  return (parsed.getTime() - now.getTime()) / 3_600_000;
}

/** Parse CODINEU-ish "23/09/26 09:00 ART" or ISO. */
export function parseFlexibleDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);

  // DD/MM/YY[YY] HH:MM
  const m = s.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[1], 10);
  const hour = m[4] ? parseInt(m[4], 10) : 12;
  const min = m[5] ? parseInt(m[5], 10) : 0;
  // Approximate ART as UTC-3
  const d = new Date(Date.UTC(year, month, day, hour + 3, min));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function currentYearMonth(now = new Date()): string {
  // Format in ART roughly
  const art = new Date(now.getTime() - 3 * 3600_000);
  const y = art.getUTCFullYear();
  const m = String(art.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function tzLabel(): string {
  return APP_TZ;
}
