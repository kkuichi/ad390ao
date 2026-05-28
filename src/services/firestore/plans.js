// Týždenný plán: plans/{uid}/weeks/{isoWeek}, jedlá raňajky/obed/večera.
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';


const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

function weekRef(uid, yyyyWw) {
  return doc(db, 'plans', uid, 'weeks', yyyyWw);
}

// Normalizuje meal entry – string id alebo objekt na jednotný `{ recipeId, servings }`.

export function normalizeMealEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const recipeId = entry.trim();
    return recipeId ? { recipeId, servings: null } : null;
  }
  if (typeof entry === 'object') {
    const recipeId = String(entry.recipeId || '').trim();
    if (!recipeId) return null;
    const raw = Number(entry.servings);
    const servings = Number.isFinite(raw) && raw > 0 ? raw : null;
    return { recipeId, servings };
  }
  return null;
}

function normalizeMealList(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeMealEntry)
    .filter(Boolean);
}

function normalizeDay(day) {
  const meals = day?.meals ?? {
    breakfast: [],
    lunch: [],
    dinner: (day?.recipes ?? []).length ? day.recipes : [],
  };
  if (day?.recipes?.length && !meals.dinner?.length) meals.dinner = [...day.recipes];
  return {
    date: day.date,
    meals: {
      breakfast: normalizeMealList(meals.breakfast),
      lunch: normalizeMealList(meals.lunch),
      dinner: normalizeMealList(meals.dinner),
    },
  };
}


export function getWeekId(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // dni do pondelka
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  const y = monday.getFullYear();
  const jan1 = new Date(y, 0, 1);
  let weekNum = Math.floor((monday - jan1) / 86400000 / 7) + 1;
  if (weekNum < 1) return `${y - 1}-52`;
  if (weekNum > 52) return `${y + 1}-01`;
  return `${y}-${String(weekNum).padStart(2, '0')}`;
}



export { MEAL_TYPES };


export async function getWeekPlan(uid, yyyyWw) {
  if (!uid || !yyyyWw) return null;
  const snap = await getDoc(weekRef(uid, yyyyWw));
  if (!snap.exists()) return null;
  const data = snap.data();
  const days = (data.days ?? []).map(normalizeDay);
  return { ...data, days };
}


export async function setWeekPlan(uid, yyyyWw, plan) {
  if (!uid || !yyyyWw) return;
  await setDoc(
    weekRef(uid, yyyyWw),
    { ...plan, updatedAt: serverTimestamp() },
    { merge: true },
  );
}


export async function addRecipeToPlan(
  uid,
  yyyyWw,
  dateStr,
  recipeId,
  mealType = 'dinner',
  servings = null,
) {
  if (!uid || !recipeId || !dateStr) return;
  const current = await getWeekPlan(uid, yyyyWw);
  const days = current?.days ?? [];
  const dayIndex = days.findIndex((d) => d.date === dateStr);
  const mealsKey = MEAL_TYPES.includes(mealType) ? mealType : 'dinner';

  const entry = normalizeMealEntry({ recipeId, servings });
  if (!entry) return;

  let newDays;
  if (dayIndex >= 0) {
    const day = normalizeDay(days[dayIndex]);
    const list = [...(day.meals[mealsKey] || []), entry];
    newDays = [...days];
    newDays[dayIndex] = { ...day, meals: { ...day.meals, [mealsKey]: list } };
  } else {
    const meals = { breakfast: [], lunch: [], dinner: [] };
    meals[mealsKey] = [entry];
    newDays = [...days, { date: dateStr, meals }].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }
  await setWeekPlan(uid, yyyyWw, { days: newDays });
}

// Odstráni recept z dňa a typu jedla – odstráni PRVÝ výskyt (zachováva spätnú
// kompatibilitu so starším volaním, kde sa filtrovalo podľa recipeId).

export async function removeRecipeFromPlan(uid, yyyyWw, dateStr, recipeId, mealType) {
  if (!uid) return;
  const current = await getWeekPlan(uid, yyyyWw);
  const days = current?.days ?? [];
  const dayIndex = days.findIndex((d) => d.date === dateStr);
  if (dayIndex < 0) return;
  const day = normalizeDay(days[dayIndex]);
  const key = MEAL_TYPES.includes(mealType) ? mealType : 'dinner';

  const list = [...(day.meals[key] || [])];
  const idx = list.findIndex((e) => e.recipeId === recipeId);
  if (idx < 0) return;
  list.splice(idx, 1);

  const newDays = [...days];
  newDays[dayIndex] = { ...day, meals: { ...day.meals, [key]: list } };
  await setWeekPlan(uid, yyyyWw, { days: newDays });
}

// Odstráni meal entry podľa indexu (jednoznačne, aj keď je recept v pláne viackrát).

export async function removeMealAt(uid, yyyyWw, dateStr, mealType, index) {
  if (!uid || index == null || index < 0) return;
  const current = await getWeekPlan(uid, yyyyWw);
  const days = current?.days ?? [];
  const dayIndex = days.findIndex((d) => d.date === dateStr);
  if (dayIndex < 0) return;
  const day = normalizeDay(days[dayIndex]);
  const key = MEAL_TYPES.includes(mealType) ? mealType : 'dinner';

  const list = [...(day.meals[key] || [])];
  if (index >= list.length) return;
  list.splice(index, 1);

  const newDays = [...days];
  newDays[dayIndex] = { ...day, meals: { ...day.meals, [key]: list } };
  await setWeekPlan(uid, yyyyWw, { days: newDays });
}

// Aktualizuje počet porcií konkrétneho meal entry (podľa indexu).

export async function updateMealServings(
  uid,
  yyyyWw,
  dateStr,
  mealType,
  index,
  servings,
) {
  if (!uid || index == null || index < 0) return;
  const current = await getWeekPlan(uid, yyyyWw);
  const days = current?.days ?? [];
  const dayIndex = days.findIndex((d) => d.date === dateStr);
  if (dayIndex < 0) return;
  const day = normalizeDay(days[dayIndex]);
  const key = MEAL_TYPES.includes(mealType) ? mealType : 'dinner';

  const list = [...(day.meals[key] || [])];
  if (index >= list.length) return;

  const raw = Number(servings);
  const safeServings = Number.isFinite(raw) && raw > 0 ? raw : null;
  list[index] = { ...list[index], servings: safeServings };

  const newDays = [...days];
  newDays[dayIndex] = { ...day, meals: { ...day.meals, [key]: list } };
  await setWeekPlan(uid, yyyyWw, { days: newDays });
}
