// Detekcia diétnej vhodnosti receptov.


// Stemy slov, ktoré označujú mäso, ryby a morské plody.

const MEAT_STEMS = [
  // hydina
  'kura', 'kurac', 'kurci', 'kurence', 'kuriat', 'kurat',
  'morka', 'moriak', 'morcac',
  'kacac', 'kacic', 'kacka', 'kacat',
  'husac',
  // mäso všeobecne / červené mäso
  'maso', 'masa', 'mase', 'masom', 'masu',
  'hovadz', 'biftek',
  'bravcov',
  'jahna', 'baranin', 'telac',
  // mäsové výrobky a špeciality
  'slanin', 'sunka', 'sunke', 'sunky', 'sunkou',
  'klobas', 'salam', 'parky', 'parok', 'parka',
  'udeni', 'oskvar', 'skvar', 'spek', 'bocik',
  'sekan', 'gulas', 'rezen', 'rezn', 'steak',
  'rebier', 'rebra', 'rebierk',
  'pecien', 'pasteta',
  // ryby
  'ryba', 'ryby', 'rybu', 'rybou', 'rybacie', 'rybacia',
  'losos', 'tuniak', 'treska', 'tresky', 'kapor', 'pstruh',
  'sardin', 'platesa', 'halibut', 'sled', 'makrela',
  // morské plody
  'krevet', 'kalamar', 'kalmar', 'garnat', 'chobotnic', 'midia', 'midie',
  // divina / králik
  'jelen', 'srnc', 'srni', 'diviak', 'kralic',
];

// Slová, ktoré po normalizácii síce začínajú niektorým mäsovým stemom, ale
// mäso neoznačujú (false-positive blacklist).

const NON_MEAT_WORDS = new Set([
  'kurkuma', 'kurkumy', 'kurkumou', 'kurkumovy', 'kurkumovou',
  'mascarpone', 'mascarponu', 'mascarponou', 'mascarpony',
]);

// Lower-case, NFD bez diakritiky a zjednotené medzery.

function normalizeIngredientName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// True ak token = ingrediencia z mäsovej rodiny (a nie blacklisted false-positive).

export function isMeatToken(token) {
  if (!token) return false;
  if (NON_MEAT_WORDS.has(token)) return false;
  for (const stem of MEAT_STEMS) {
    if (token.startsWith(stem)) return true;
  }
  return false;
}

// Recept považujeme za vegetariánsky, ak žiadna jeho ingrediencia neobsahuje
// mäsový token. Prázdny zoznam ingrediencií → false (radšej nesprávame domnienky).

export function isVegetarianByIngredients(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return false;
  for (const ing of ingredients) {
    const raw = typeof ing === 'string' ? ing : (ing && ing.name) || '';
    const norm = normalizeIngredientName(raw);
    if (!norm) continue;
    const tokens = norm.split(/[^a-z]+/).filter(Boolean);
    for (const tok of tokens) {
      if (isMeatToken(tok)) return false;
    }
  }
  return true;
}

// True, ak `dietaryPrefs` (z profilu) obsahuje vegetarián / vegán.

export function isVegetarianOrVeganProfile(dietaryPrefs) {
  if (!Array.isArray(dietaryPrefs)) return false;
  return dietaryPrefs.some((p) => {
    const norm = (p || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return norm === 'vegetarian' || norm === 'vegan' || norm === 'vegetarian/vegan';
  });
}


export function isRecipeAllowedForDiet(recipe, dietaryPrefs) {
  if (!isVegetarianOrVeganProfile(dietaryPrefs)) return true;

  const tags = Array.isArray(recipe?.tags) ? recipe.tags : [];
  const tagLooksVeggie = tags.some((t) => {
    const n = (t || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return n.includes('vegetarian') || n.includes('vegan');
  });
  if (tagLooksVeggie) return true;

  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  return isVegetarianByIngredients(ingredients);
}
