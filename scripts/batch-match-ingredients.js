#!/usr/bin/env node
// Mapovanie ingrediencií z receptov na produkty v prices (Gemini) -> ingredient_price_mappings
// Potrebné: GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS. Model default gemini-2.5-flash.

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PROJECT_ID = 'mealbuddy-ba30f';
const DELAY_MS = 5000;
const CACHE_COLLECTION = 'ingredient_price_mappings';

if (!GEMINI_API_KEY.trim()) {
  console.error(
    '\nChýba GEMINI_API_KEY.\n' +
      'Nastav: export GEMINI_API_KEY="..."\n' +
      'A: GOOGLE_APPLICATION_CREDENTIALS="...json" node scripts/batch-match-ingredients.js\n',
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

console.log(`Používam model ${GEMINI_MODEL}`);

function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSlug(s) {
  if (!s) return '';
  return normalizeName(s.replace(/_/g, ' '))
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
}

function cacheKey(name, qty, unit) {
  return `${toSlug(name)}_${qty ?? 1}_${(unit || 'ks').toLowerCase()}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log('\nNačítavam recepty...');
  const recipesSnap = await db.collection('recipes').get();
  const uniqueIngredients = new Map();

  recipesSnap.forEach((d) => {
    const data = d.data();
    const ingredients = data.ingredients || [];
    for (const ing of ingredients) {
      const name = typeof ing === 'string' ? ing : (ing.name || '');
      if (!name) continue;
      const qty = ing.qty ?? 1;
      const unit = (ing.unit || 'ks').toLowerCase().trim();

      if (['podľa chuti', 'podle chuti', 'štipka', 'stipka', 'na ozdobu', 'podla chuti'].includes(unit)) continue;

      const key = cacheKey(name, qty, unit);
      if (!uniqueIngredients.has(key)) {
        uniqueIngredients.set(key, { name, qty, unit, key });
      }
    }
  });

  console.log(`  ${uniqueIngredients.size} rôznych ingrediencií (${recipesSnap.size} receptov)`);

  console.log('Načítavam cenník prices...');
  const pricesSnap = await db.collection('prices').get();
  const catalog = [];
  pricesSnap.forEach((d) => {
    const data = d.data();
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const priceEur = typeof data.priceEur === 'number'
      ? data.priceEur
      : (offers.length > 0 ? offers[0].priceEur : 0);
    catalog.push({
      id: d.id,
      name: data.name || d.id,
      unit: data.unit || 'ks',
      priceEur: priceEur || 0,
    });
  });
  console.log(`  ${catalog.length} produktov`);

  console.log('Kontrolujem, čo už je v cache...');
  const existingSnap = await db.collection(CACHE_COLLECTION).get();
  const existingKeys = new Set();
  existingSnap.forEach((d) => existingKeys.add(d.id));
  console.log(`  ${existingKeys.size} už uložených`);

  const toProcess = [];
  for (const [key, ing] of uniqueIngredients) {
    if (!existingKeys.has(key)) {
      toProcess.push(ing);
    }
  }

  if (toProcess.length === 0) {
    console.log('\nVšetko už je v cache, nič nové.\n');
    process.exit(0);
  }

  console.log(`  zostáva spracovať: ${toProcess.length}\n`);

  const productList = catalog
    .map((p) => `${p.id} | ${p.name} | ${p.unit} | ${p.priceEur}€`)
    .join('\n');

  console.log('Volám Gemini...\n');

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const ing = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    try {
      const prompt = `Si asistent pre slovenský nákupný zoznam potravín. Zmapuj ingredienciu z receptu na najvhodnejší produkt z databázy cien.

INGREDIENCIA Z RECEPTU:
- Názov: "${ing.name}"
- Množstvo: ${ing.qty}
- Jednotka: ${ing.unit}

DOSTUPNÉ PRODUKTY (id | názov | jednotka | cena):
${productList}

PRAVIDLÁ:
1. Vyber JEDEN najvhodnejší produkt alebo null ak žiadny nesedí.
2. Prepočítaj množstvo na jednotku produktu:
   - "celé kura (cca 1,5 kg)" = 1 ks -> produkt v kg -> qtyInProductUnit = 1.5
   - "3 vajcia" -> produkt vajcia_ks -> qtyInProductUnit = 3
   - "500 ml mlieka" -> produkt v l -> qtyInProductUnit = 0.5
   - "200 g masla" -> produkt v kg -> qtyInProductUnit = 0.2
   - "1 PL oleja" = 15 ml -> produkt v l -> qtyInProductUnit = 0.015
3. Koreniny/omáčky bez matchnutého produktu -> null.
4. Confidence: 0.9+ presný, 0.5-0.8 podobný, pod 0.4 nepresný.

Odpovedz VÝHRADNE platným JSON (bez markdown):
{"matchedDocId": "id" alebo null, "qtyInProductUnit": číslo, "confidence": číslo 0-1, "explanation": "vysvetlenie"}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.log(`${progress} ${ing.name} - bez JSON odpovede`);
        failed++;
        await sleep(DELAY_MS);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const matchedDocId = parsed.matchedDocId || null;
      const qtyInProductUnit = Number(parsed.qtyInProductUnit) || 0;
      const confidence = Number(parsed.confidence) || 0;
      const explanation = parsed.explanation || '';

      if (matchedDocId && !catalog.some((p) => p.id === matchedDocId)) {
        console.log(`${progress} ${ing.name} - neznámy produkt ${matchedDocId}`);
        await db.collection(CACHE_COLLECTION).doc(ing.key).set({
          matchedDocId: null,
          qtyInProductUnit: 0,
          confidence: 0,
          explanation: `${explanation} (doc ID not in catalog)`,
          ingredientName: ing.name,
          ingredientQty: ing.qty,
          ingredientUnit: ing.unit,
          createdAt: Date.now(),
          source: 'batch-script',
        });
        skipped++;
        await sleep(DELAY_MS);
        continue;
      }

      await db.collection(CACHE_COLLECTION).doc(ing.key).set({
        matchedDocId,
        qtyInProductUnit,
        confidence,
        explanation,
        ingredientName: ing.name,
        ingredientQty: ing.qty,
        ingredientUnit: ing.unit,
        createdAt: Date.now(),
        source: 'batch-script',
      });

      if (matchedDocId) {
        console.log(`${progress} ${ing.name} -> ${matchedDocId} (${qtyInProductUnit}, conf ${confidence})`);
      } else {
        console.log(`${progress} ${ing.name} -> bez páru`);
      }
      success++;

    } catch (err) {
      const msg = String(err.message || err);
      if (msg.includes('429') || msg.includes('quota')) {
        if (msg.includes('PerDay') || msg.includes('limit: 0')) {
          console.log(`\nDenný limit API, končím. Spracované: ${success}`);
          console.log('Zajtra spusti znova - pokračuje od neuložených.\n');
          break;
        }
        console.log(`${progress} limit, čakám minútu...`);
        await sleep(65000);
        i--;
        continue;
      }
      console.log(`${progress} ${ing.name} - chyba: ${msg}`);
      if (err?.stack) console.error(err.stack);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\nHotovo.');
  console.log(`  uložené: ${success}, preskočené: ${skipped}, chyby: ${failed}`);
  console.log(`  kolekcia: ${CACHE_COLLECTION}\n`);

  process.exit(0);
})();
