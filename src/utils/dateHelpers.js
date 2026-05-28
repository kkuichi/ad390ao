// Centralizované dátumové utility pre týždenný plán a rozpočet.


function toLocalIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}


export function getCurrentWeekMonday(ref) {
  const d = ref ? new Date(ref) : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}


export function getPlanningWeekMonday(ref) {
  return getCurrentWeekMonday(ref);
}


export function getPlanningWeekDates(ref) {
  return getCurrentWeekDates(ref);
}


export function getCurrentWeekDates(ref) {
  const monday = getCurrentWeekMonday(ref);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out.push(toLocalIsoDate(d));
  }
  return out;
}


export function getPlanningWeekId(ref) {
  const d = ref ? new Date(ref) : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const y = monday.getFullYear();
  const jan1 = new Date(y, 0, 1);
  let weekNum = Math.floor((monday - jan1) / 86400000 / 7) + 1;
  if (weekNum < 1) return `${y - 1}-52`;
  if (weekNum > 52) return `${y + 1}-01`;
  return `${y}-${String(weekNum).padStart(2, '0')}`;
}


export function getCurrentWeekRange(ref) {
  const mondayStart = getCurrentWeekMonday(ref);
  const nextMonday = new Date(mondayStart);
  nextMonday.setDate(mondayStart.getDate() + 7);
  return { mondayStart, nextMonday };
}
