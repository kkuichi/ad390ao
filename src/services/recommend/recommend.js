// Odporúčania na Domove: diéta, špajza, cena, čas prípravy.
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { getProfile } from '../firestore/profiles';
import { toNameNormKey, fuzzyMatchPantry } from '../../utils/ingredientNorm';
import { isRecipeAllowedForDiet, isVegetarianOrVeganProfile } from '../../utils/dietary';

const DEFAULT_FETCH_LIMIT = 80;
const W_PANTRY = 0.4;
const W_PRICE = 0.35;
const W_TIME = 0.25;

function normalizeTag(t) {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}


function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tagMatchesPreference(tag, pref) {
  const t = normalizeTag(tag);
  const p = normalizeTag(pref);
  if (!t || !p) return false;
  return t.includes(p) || p.includes(t);
}

// Počet ingrediencií receptu pokrytých zo špajzy (fuzzy match).
// Exportované pre RecipesScreen / RecipeDetail.

export function countPantryMatches(recipeIngredients, pantryNameNorms) {
  if (!recipeIngredients?.length || !pantryNameNorms?.size) return 0;
  let count = 0;
  for (const name of recipeIngredients) {
    const n = (typeof name === 'string' ? name : name?.name || '').trim();
    if (!n) continue;
    const key = toNameNormKey(n);
    if (fuzzyMatchPantry(key, pantryNameNorms)) count += 1;
  }
  return count;
}


function scoreRecipe(recipe, profile, pantryNameNorms, remainingBudget) {
  const ingredients = recipe.ingredients ?? [];
  const totalIng = ingredients.length;
  
  // percentFromPantry: % ingrediencií/gramáže pokrytej špajzou
  const pantryMatch = totalIng > 0 ? countPantryMatches(ingredients, pantryNameNorms) / totalIng : 0;
  
  // budgetFit: penalizuj recepty, ktoré by prekročili zostávajúci týždenný limit
  const pricePerPortion = recipe.pricePerPortionEstimate;
  let budgetFit = 0.5;
  if (typeof remainingBudget === 'number' && remainingBudget > 0 && typeof pricePerPortion === 'number') {
    if (pricePerPortion <= remainingBudget) {
      budgetFit = 1 - (pricePerPortion / remainingBudget) * 0.5; // vyššie skóre pre lacnejšie
    } else {
      budgetFit = Math.max(0, 1 - (pricePerPortion - remainingBudget) / remainingBudget); // penalizácia za prekročenie
    }
  } else if (typeof pricePerPortion === 'number') {
    const maxPrice = typeof profile?.weeklyBudget === 'number' && profile.weeklyBudget > 0 ? profile.weeklyBudget * 1.5 : 10;
    budgetFit = Math.max(0, 1 - pricePerPortion / maxPrice);
  }
  
  // timeFit: preferuj rýchle (napr. <30 min)
  const durationMin = recipe.durationMin;
  const timeFit = durationMin != null ? Math.max(0, 1 - durationMin / 60) : 0.5;
  
  // equipmentFit: rešpektuj profile.equipment[]
  const equipment = profile?.equipment ?? [];
  const tags = recipe.tags ?? [];
  let equipmentFit = 0.5;
  if (equipment.length > 0) {
    const hasMatchingEquipment = tags.some((t) => equipment.some((e) => tagMatchesPreference(t, e)));
    equipmentFit = hasMatchingEquipment ? 1 : 0.3; // penalizuj ak chýba equipment
  }
  
  // Základné skóre
  let score = W_PANTRY * pantryMatch + W_PRICE * budgetFit + W_TIME * timeFit;
  
  // equipmentFit ako bonus
  score += equipmentFit * 0.15;
  
  // Bonus za dietary preferences
  const prefs = profile?.dietaryPrefs ?? [];
  for (const pref of prefs) {
    for (const tag of tags) {
      if (tagMatchesPreference(tag, pref)) {
        score += 0.2;
        break;
      }
    }
  }

  return score;
}

// Krátky dôvod prečo odporúčame: "N položiek zo špajzi, ~X €, Y min".

function buildWhy(recipe, pantryMatchCount) {
  const parts = [];
      if (pantryMatchCount > 0) parts.push(`pokrýva ${pantryMatchCount} položiek zo špajzi`);
  const price = recipe.pricePerPortionEstimate;
  if (typeof price === 'number') parts.push(`~${price.toFixed(2)} €`);
  else parts.push('– €');
  const min = recipe.durationMin;
  if (min != null) parts.push(`${min} min`);
  return parts.join(', ') || 'Odporúčaný recept';
}


export async function recommendRecipes(userId, opts = {}) {
  const lim = Math.max(3, opts.limit ?? 6);
  const pantryItems = opts.pantryItems ?? [];
  const pantryNameNorms = new Set(pantryItems.map((p) => toNameNormKey(p.name)).filter(Boolean));
  const remainingBudget = opts.remainingBudget; // zostávajúci rozpočet na týždeň

  try {
    let profile = null;
    if (userId) {
      profile = await getProfile(userId);
    }

    const ref = collection(db, 'recipes');
    const q = query(ref, limit(DEFAULT_FETCH_LIMIT));
    const snap = await getDocs(q);
    const recipes = snap.docs.map((d) => {
      const data = d.data();
      const ingredients = data.ingredients ?? [];
      return {
        id: d.id,
        name: data.name ?? 'Recept',
        durationMin: data.durationMin,
        servings: data.servings,
        tags: data.tags ?? [],
        pricePerPortionEstimate: data.pricePerPortionEstimate,
        imageUrl: data.imageUrl ?? null,
        rawIngredients: ingredients,
        ingredients: ingredients.map((i) => (typeof i === 'string' ? i : (i && i.name) || '')).filter(Boolean),
      };
    });

    const dietaryPrefs = profile?.dietaryPrefs ?? [];
    const filteredRecipes = isVegetarianOrVeganProfile(dietaryPrefs)
      ? recipes.filter((r) =>
          isRecipeAllowedForDiet(
            { tags: r.tags, ingredients: r.rawIngredients },
            dietaryPrefs,
          ),
        )
      : recipes;

    // Per-user seed pre stabilný tie-break. Bez seedu by všetci používatelia
    // s defaultným profilom videli rovnaké poradie a tým aj rovnaké top recepty.
    const userSeed = userId ? hashStr(userId) : 0;

    const withScore = filteredRecipes.map((r) => {
      const pantryMatchCount = countPantryMatches(r.ingredients, pantryNameNorms);
      const baseScore = scoreRecipe(r, profile, pantryNameNorms, remainingBudget);
      // Tie-break v ráde 0.000–0.020. Skutočné rozdiely v skóre (typicky 0.05+)
      // ostávajú dominantné, ale pri remízach rozhodne per-user hash.
      const tieBreak = (hashStr(`${r.id}:${userSeed}`) % 2000) / 100000;
      const _score = baseScore + tieBreak;
      const why = buildWhy(r, pantryMatchCount);
      // `rawIngredients` bolo iba pre filter – nepublikujeme ho ďalej, aby sa
      // rovnaký objekt nedostal do UI s nečakaným tvarom.
      const { rawIngredients: _ri, ...clean } = r;
      return { ...clean, _score, why, pantryMatchCount };
    });
    withScore.sort((a, b) => (b._score !== a._score ? b._score - a._score : 0));
    const top = withScore.slice(0, lim).map(({ _score, ...r }) => r);
    return top;
  } catch (_) {
    return [];
  }
}


export async function recommendWithModel(input) {
  return null;
}

export default recommendRecipes;
