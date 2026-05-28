// Pomocné funkcie pre rozpočtový týždeň (pondelok – nedeľa) a normalizáciu časových značiek.
import { getCurrentWeekMonday } from './dateHelpers';

function toMs(v) {
  if (v == null) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function startOfDayMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getBudgetCycleAnchorMs(profile, refDate = new Date()) {
  const refMs = startOfDayMs(refDate.getTime());
  const anchorRaw = profile?.budgetCycleAnchorAt ?? profile?.createdAt ?? profile?.updatedAt;
  const parsed = toMs(anchorRaw);
  return parsed > 0 ? startOfDayMs(parsed) : refMs;
}

// Týždenný rozpočet: kalendárny pondelok–nedeľa (rovnaké okno ako týždenný plán).
// `profile` sa používa len kvôli kompatibilite API; hranice cyklu sú vždy od pondelka 00:00.

export function getBudgetCycleRange(profile, refDate = new Date()) {
  const cycleStart = getCurrentWeekMonday(refDate);
  const nextCycleStart = new Date(cycleStart);
  nextCycleStart.setDate(cycleStart.getDate() + 7);
  const dayMs = 24 * 60 * 60 * 1000;
  const cycleIndex = Math.floor(startOfDayMs(cycleStart.getTime()) / (7 * dayMs));
  return {
    cycleStart,
    nextCycleStart,
    cycleIndex,
  };
}


export function formatBudgetCycleRangeShort(profile, refDate = new Date()) {
  const { cycleStart, nextCycleStart } = getBudgetCycleRange(profile ?? {}, refDate);
  const fmt = (d) =>
    d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'short' });
  const lastDayMs = nextCycleStart.getTime() - 24 * 60 * 60 * 1000;
  const lastDay = new Date(lastDayMs);
  return `${fmt(cycleStart)} – ${fmt(lastDay)}`;
}

