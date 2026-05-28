#!/usr/bin/env node
// Lacnejšie náhrady produktov z prices -> cheaper_alternatives (Gemini)
// Potrebné: GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS

const path = require('path');
const fs = require('fs');
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PROJECT_ID = 'mealbuddy-ba30f';
const DELAY_MS = 4000;
const CACHE_COLLECTION = 'cheaper_alternatives';
const MIN_CONFIDENCE = 0.5;
const MAX_ALTS = 3;
const LOCAL_KEY_PATH = path.join(__dirname, 'mealbuddy-ba30f-firebase-adminsdk-fbsvc-cb97864d0e.json');

function buildAdminAppOptions() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { projectId: PROJECT_ID, credential: applicationDefault() };
  }
  if (fs.existsSync(LOCAL_KEY_PATH)) {
    return { projectId: PROJECT_ID, credential: cert(require(LOCAL_KEY_PATH)) };
  }
  console.error('Chýba GOOGLE_APPLICATION_CREDENTIALS (service account JSON).');
  process.exit(1);
}

if (!GEMINI_API_KEY.trim()) {
  console.error('Chýba GEMINI_API_KEY.');
  process.exit(1);
}

initializeApp(buildAdminAppOptions());
const db = getFirestore();
const model = new GoogleGenerativeAI(GEMINI_API_KEY).getGenerativeModel({ model: GEMINI_MODEL });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cheapestPriceEur = (data) => {
  const offers = Array.isArray(data.offers) ? data.offers : [];
  const fromOffers = offers
    .map((o) => Number(o.priceEur))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)[0];
  if (Number.isFinite(fromOffers)) return fromOffers;
  const direct = Number(data.priceEur);
  return Number.isFinite(direct) && direct > 0 ? direct : 0;
};

const normalizeName = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const toSlug = (s) => normalizeName(s).replace(/\s+/g, '_');

async function loadUsedSlugs() {
  const snap = await db.collection('recipes').get();
  const used = new Set();
  snap.forEach((d) => (d.data()?.ingredients || []).forEach((i) => used.add(toSlug(typeof i === 'string' ? i : i?.name || ''))));
  used.delete('');
  return used;
}

async function main() {
  console.log(`Model ${GEMINI_MODEL}\n`);
  console.log('Načítavam prices...');
  const pricesSnap = await db.collection('prices').get();
  const catalog = [];
  pricesSnap.forEach((d) => {
    const data = d.data();
    const price = cheapestPriceEur(data);
    if (!price) return;
    catalog.push({ id: d.id, name: data.name || d.id, unit: (data.unit || 'ks').toLowerCase(), priceEur: price });
  });
  console.log(`  ${catalog.length} položiek`);

  const usedSlugs = await loadUsedSlugs();
  const usedIds = new Set(catalog.filter((p) => usedSlugs.has(p.id) || usedSlugs.has(p.id.replace(/_(kg|g|l|ml|ks)$/, ''))).map((p) => p.id));
  console.log(`  ${usedIds.size} sa používa v receptoch`);

  const existingSnap = await db.collection(CACHE_COLLECTION).get();
  const existing = new Set(existingSnap.docs.map((d) => d.id));
  const toProcess = catalog.filter((p) => usedIds.has(p.id) && !existing.has(p.id));

  if (toProcess.length === 0) {
    console.log('\nNič nové na spracovanie.\n');
    process.exit(0);
  }

  console.log(`  spracujem ${toProcess.length} produktov\n`);

  const productList = catalog.map((p) => `${p.id} | ${p.name} | ${p.unit} | ${p.priceEur.toFixed(2)}€`).join('\n');

  let ok = 0;
  let empty = 0;
  let errCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const src = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    try {
      const prompt = `Si kuchársky asistent. Navrhni max ${MAX_ALTS} lacnejšie náhrady z katalógu pre produkt:
${src.id} (${src.name}, ${src.unit}, ${src.priceEur.toFixed(2)} €)

Katalóg:
${productList}

Pravidlá: rovnaká jednotka, lacnejšie, podobné použitie. Ak nič, alternatives: [].
JSON: {"alternatives":[{"altDocId":"id","reason":"krátko","confidence":0.0}]}`;

      const text = (await model.generateContent(prompt)).response.text().trim();
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : { alternatives: [] };
      const used = new Set([src.id]);
      const alternatives = [];

      for (const a of Array.isArray(parsed.alternatives) ? parsed.alternatives : []) {
        const altId = String(a?.altDocId || '').trim();
        const alt = catalog.find((p) => p.id === altId);
        const conf = Number(a?.confidence);
        if (!altId || used.has(altId) || !alt) continue;
        if (alt.unit !== src.unit || alt.priceEur >= src.priceEur) continue;
        if (!Number.isFinite(conf) || conf < MIN_CONFIDENCE) continue;
        alternatives.push({
          altDocId: alt.id,
          altName: alt.name,
          altUnit: alt.unit,
          altPriceSnapshot: Math.round(alt.priceEur * 100) / 100,
          savingsPctSnapshot: Math.round(((src.priceEur - alt.priceEur) / src.priceEur) * 100),
          reason: String(a?.reason || '').slice(0, 200),
          confidence: Math.round(conf * 100) / 100,
        });
        used.add(altId);
        if (alternatives.length >= MAX_ALTS) break;
      }

      await db.collection(CACHE_COLLECTION).doc(src.id).set({
        sourceDocId: src.id,
        sourceName: src.name,
        sourceUnit: src.unit,
        sourcePriceSnapshot: Math.round(src.priceEur * 100) / 100,
        alternatives,
        generatedBy: GEMINI_MODEL,
        createdAt: Date.now(),
        source: 'batch-script',
      });

      if (alternatives.length === 0) {
        console.log(`${progress} ${src.name} - žiadna lacnejšia`);
        empty++;
      } else {
        const names = alternatives.map((a) => `${a.altName} (-${a.savingsPctSnapshot}%)`).join(', ');
        console.log(`${progress} ${src.name}: ${names}`);
        ok++;
      }
      await sleep(DELAY_MS);
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes('429') || msg.includes('quota')) {
        if (msg.includes('PerDay') || msg.includes('limit: 0')) {
          console.log(`\nDenný limit API, končím (uložené ${ok}).\n`);
          break;
        }
        console.log(`${progress} limit, čakám...`);
        await sleep(65000);
        i--;
        continue;
      }
      console.log(`${progress} ${src.name} - chyba: ${msg}`);
      errCount++;
    }
  }

  console.log('\nHotovo.');
  console.log(`  s alternatívou: ${ok}, bez náhrady: ${empty}, chyby: ${errCount}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
