#!/usr/bin/env node
// Recepty.sk - viac kategórií, jeden recept = jeden záznam s poľom categories
// GOOGLE_APPLICATION_CREDENTIALS=...json node scripts/scrape-recepty-sk-categories.js

const {
  BASE,
  DELAY_MS,
  fetchHtml,
  parseListing,
  parseRecipeDetail,
  uploadRecipeImage,
  sleep,
} = require('./scrape-recepty-sk.js');

const CATEGORIES = [
  { url: `${BASE}/chod/ranajky/`, label: 'Raňajky' },
  { url: `${BASE}/chod/obed-vecera/`, label: 'Obed / večera' },
  { url: `${BASE}/chod/predjedlo/`, label: 'Predjedlo' },
  { url: `${BASE}/chod/dezert/`, label: 'Dezerty' },
  { url: `${BASE}/chod/napoj/`, label: 'Nápoj' },
  { url: `${BASE}/bezmasite-jedla/`, label: 'Bezmäsité jedlá' },
  { url: `${BASE}/fit-recepty/`, label: 'Fit recepty' },
  { url: `${BASE}/fit-recepty/vegetarianske-recepty/`, label: 'Vegetariánske' },
  { url: `${BASE}/fit-recepty/veganske-recepty-raw-strava/`, label: 'Vegánske' },
  { url: `${BASE}/fit-recepty/salaty/`, label: 'Šaláty' },
  { url: `${BASE}/polievky/`, label: 'Polievky' },
  { url: `${BASE}/dezerty/`, label: 'Dezerty' },
  { url: `${BASE}/pizza-cestoviny/`, label: 'Pizza a cestoviny' },
  { url: `${BASE}/sezonne-recepty/`, label: 'Sezónne recepty' },
  { url: `${BASE}/masove-speciality/mlete-maso/`, label: 'Mleté mäso' },
];

const MAX_RECIPES = parseInt(process.env.MAX_RECIPES || '0', 10) || 99999;

async function main() {
  const recipeByUrl = new Map();

  console.log('\nZbieram odkazy z kategórií...');
  for (const { url, label } of CATEGORIES) {
    try {
      await sleep(800);
      const html = await fetchHtml(url);
      const links = parseListing(html, url);
      for (const { url: recipeUrl } of links) {
        if (!recipeByUrl.has(recipeUrl)) recipeByUrl.set(recipeUrl, new Set());
        recipeByUrl.get(recipeUrl).add(label);
      }
      console.log(`  ${label}: ${links.length}`);
    } catch (e) {
      console.log(`  ${label}: chyba - ${e.message}`);
    }
  }

  const allUrls = [...recipeByUrl.keys()];
  const toFetch = MAX_RECIPES > 0 ? allUrls.slice(0, MAX_RECIPES) : allUrls;
  console.log(`\nUnikátnych receptov: ${allUrls.length}, stiahnem: ${toFetch.length}`);

  let firebaseAdmin;
  try {
    firebaseAdmin = require('firebase-admin');
  } catch (_) {
    console.error('Chýba firebase-admin. Spusti: npm install cheerio firebase-admin');
    process.exit(1);
  }

  const STORAGE_BUCKET = 'mealbuddy-ba30f.firebasestorage.app';
  if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({ projectId: 'mealbuddy-ba30f', storageBucket: STORAGE_BUCKET });
  }
  const db = firebaseAdmin.firestore();

  let saved = 0;
  let failed = 0;

  console.log('\nSťahujem recepty do Firestore...\n');
  for (let i = 0; i < toFetch.length; i++) {
    const url = toFetch[i];
    const id = url.match(/\/recept\/([a-zA-Z0-9]+)\//)?.[1] || `recepty-${Date.now()}-${i}`;
    const categories = [...recipeByUrl.get(url)];
    process.stdout.write(`[${i + 1}/${toFetch.length}] ${id} (${categories.slice(0, 2).join(', ')}...)... `);
    try {
      await sleep(DELAY_MS);
      const html = await fetchHtml(url);
      const recipe = parseRecipeDetail(html, url);
      const doc = { ...recipe, categories };
      if (doc.imageSourceUrl) {
        try {
          doc.imageUrl = await uploadRecipeImage(firebaseAdmin, id, doc.imageSourceUrl);
        } catch (imgErr) {
          process.stdout.write(` [foto: ${imgErr.message}]`);
        }
        delete doc.imageSourceUrl;
      }
      Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);
      doc.createdAt = firebaseAdmin.firestore.FieldValue.serverTimestamp();
      doc.updatedAt = firebaseAdmin.firestore.FieldValue.serverTimestamp();
      await db.collection('recipes').doc(id).set(doc, { merge: true });
      console.log(doc.imageUrl ? 'uložené + foto' : 'uložené');
      saved++;
    } catch (e) {
      console.log('chyba:', e.message);
      failed++;
    }
  }

  console.log(`\nHotovo: ${saved} uložených, ${failed} chýb\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
