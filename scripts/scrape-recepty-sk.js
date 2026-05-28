#!/usr/bin/env node
// Recepty.sk -> Firestore recipes (pomocný modul + samostatné spustenie)
// TEST=1 len vypíše parsovanie, SKIP_IMAGES=1 bez fotiek

const BASE = 'https://recepty.aktuality.sk';
const DELAY_MS = 2000;
const MAX_RECIPES = parseInt(process.env.MAX_RECIPES || '0', 10) || 999;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MealBuddy/1.0 (educational project)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function parseListing(html, listingUrl) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();
  const scope = $('.recipe-list-container, .recipe-list-widget').length
    ? '.recipe-list-container a[href*="/recept/"], .recipe-list-widget a[href*="/recept/"]'
    : 'a[href*="/recept/"]';
  $(scope).each((_, el) => {
    if ($(el).closest('aside, .list-side-section, [class*="sidebar"]').length) return;
    let href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('//')) href = 'https:' + href;
    else if (href.startsWith('/')) href = BASE + href;
    if (!href.startsWith(BASE + '/recept/')) return;
    if (seen.has(href)) return;
    seen.add(href);
    const title = $(el).attr('title') || $(el).text().trim();
    if (title && title.length > 2 && title.length < 200) {
      links.push({ url: href, title });
    }
  });
  return links;
}

function parseRecipeDetail(html, url) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.replace(/\s*\|\s*RECEPTY\.sk$/, '').trim() ||
    '';

  const imageSourceUrl = $('meta[property="og:image"]').attr('content')?.replace(/&amp;/g, '&')?.trim() || null;

  let servings = null;
  const fullText = $('body').text();
  const porcieMatch = fullText.match(/Porcie\s*(\d+)/i);
  if (porcieMatch) servings = parseInt(porcieMatch[1], 10);

  let durationMin = null;
  const pripravaMatch = fullText.match(/Príprava\s*(\d+)\s*min/i);
  const upravaMatch = fullText.match(/Úprava\s*(\d+)\s*min/i);
  if (pripravaMatch) durationMin = (durationMin || 0) + parseInt(pripravaMatch[1], 10);
  if (upravaMatch) durationMin = (durationMin || 0) + parseInt(upravaMatch[1], 10);
  if (durationMin === 0) durationMin = null;

  const ingredients = [];
  $('ul.ingredients-list li.ingredient-item').each((_, li) => {
    const countEl = $(li).find('.count').first();
    const nameEl = $(li).find('.name').first();
    const name = nameEl.text().replace(/\s+/g, ' ').trim();
    if (!name || name.length > 150) return;
    const countText = countEl.text().replace(/\s+/g, ' ').trim();
    const isPodlaChuti = /podľa\s+chuti|podle\s+chuti/i.test(countText) || countText.length < 2;
    if (isPodlaChuti) {
      ingredients.push({ name, qty: null, unit: 'podľa chuti' });
      return;
    }
    const parsed = parseCountAndName(countText, name);
    if (parsed) ingredients.push(parsed);
  });

  const seen = new Set();
  const ingredientsDedup = ingredients.filter((i) => {
    const key = `${(i.name || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${(i.unit || 'ks').trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const steps = [];
  $('ul.procedure-list li.procedure-item').each((_, li) => {
    const text = $(li).find('.procedure.article-text p, .procedure p').first().text().trim();
    if (text) steps.push(text);
  });

  const tags = [];
  $('[class*="category"] a, .breadcrumb a').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length > 1 && t.length < 50 && !/recepty|domov|hlavná/i.test(t)) tags.push(t);
  });

  const out = {
    name: title || 'Recept',
    ingredients: ingredientsDedup,
    steps,
    tags: [...new Set(tags)].slice(0, 10),
    sourceUrl: url,
    sourceName: 'Recepty.sk',
  };
  if (servings != null) out.servings = servings;
  if (durationMin != null) out.durationMin = durationMin;
  if (imageSourceUrl) out.imageSourceUrl = imageSourceUrl;
  return out;
}

// Parse amount text ("500 g", "2 PL") plus ingredient name into { name, qty, unit }.
function parseCountAndName(countText, name) {
  if (!name || !name.trim()) return null;
  const count = countText.replace(/\s+/g, ' ').trim();
  const numUnitMatch = count.match(/^(\d+[\d,.\/\-]*)\s*((?:g|kg|ml|l|dcl|ks|štúčik|strúčik|strúčiky|pl|kl|polievková|čajová|lyžica|hrsť|pár|kúsok|kusy)\s*)?$/i);
  if (numUnitMatch) {
    let qty = numUnitMatch[1].replace(',', '.');
    if (qty.includes('/')) {
      const [a, b] = qty.split('/').map(Number);
      qty = b ? a / b : parseFloat(qty) || 1;
    } else {
      qty = parseFloat(qty) || 1;
    }
    let unit = (numUnitMatch[2] || '').trim().toLowerCase() || 'ks';
    if (unit === 'pl' || unit === 'pl.') unit = 'polievková lyžica';
    if (unit === 'kl' || unit === 'kl.') unit = 'čajová lyžica';
    if (/strúčik|štúčik/.test(unit)) unit = 'strúčik';
    return { name: name.trim(), qty, unit };
  }
  return { name: name.trim(), qty: 1, unit: 'ks' };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const STORAGE_BUCKET = 'mealbuddy-ba30f.firebasestorage.app';
const SKIP_IMAGES = process.env.SKIP_IMAGES === '1';

async function fetchImageAsBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MealBuddy/1.0 (educational project)' },
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getExtensionFromUrl(url) {
  const path = url.split('?')[0];
  const ext = path.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]?.toLowerCase();
  return ext || 'jpg';
}

async function uploadRecipeImage(admin, id, imageSourceUrl) {
  if (SKIP_IMAGES || !imageSourceUrl) return null;
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const ext = getExtensionFromUrl(imageSourceUrl);
  const path = `recipes/${id}.${ext}`;
  const file = bucket.file(path);
  const buffer = await fetchImageAsBuffer(imageSourceUrl);
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

async function main() {
  const listingUrl = process.argv[2] || `${BASE}/masove-speciality/mlete-maso/`;

  if (process.env.TEST === '1') {
    console.log('Test - načítavam výpis...');
    const listHtml = await fetchHtml(listingUrl);
    const links = parseListing(listHtml, listingUrl);
    if (!links.length) {
      console.error('Žiadne recepty na výpise.');
      process.exit(1);
    }
    const { url, title } = links[0];
    console.log('Stahujem recept:', title, '\n', url);
    await sleep(500);
    const html = await fetchHtml(url);
    const recipe = parseRecipeDetail(html, url);
    if (!recipe.name) recipe.name = title;
    console.log('\nVýsledok:');
    console.log('Názov:', recipe.name);
    console.log('Porcie:', recipe.servings ?? '–');
    console.log('Čas (min):', recipe.durationMin ?? '–');
    console.log('Počet surovín:', recipe.ingredients?.length ?? 0);
    console.log('Suroviny:');
    (recipe.ingredients || []).forEach((i, idx) => {
      const amount = i.unit === 'podľa chuti' ? 'podľa chuti' : `${i.qty} ${i.unit}`;
      console.log(`  ${idx + 1}. ${amount} – ${i.name}`);
    });
    console.log('Počet krokov:', recipe.steps?.length ?? 0);
    if (recipe.steps?.length) console.log('Prvý krok:', recipe.steps[0].slice(0, 80) + '...');
    console.log('');
    process.exit(0);
  }

  let firebaseAdmin;
  try {
    firebaseAdmin = require('firebase-admin');
  } catch (_) {
    console.error('Chýba balík firebase-admin. Spusti: npm install cheerio firebase-admin');
    process.exit(1);
  }

  if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({ projectId: 'mealbuddy-ba30f', storageBucket: STORAGE_BUCKET });
  }
  const db = firebaseAdmin.firestore();

  console.log('Načítavam výpis:', listingUrl);
  if (SKIP_IMAGES) console.log('(bez fotiek)');
  const listHtml = await fetchHtml(listingUrl);
  const links = parseListing(listHtml, listingUrl);
  console.log('Nájdených odkazov na recepty:', links.length);

  const toFetch = MAX_RECIPES > 0 ? links.slice(0, MAX_RECIPES) : links;
  let saved = 0;
  let failed = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const { url, title } = toFetch[i];
    process.stdout.write(`[${i + 1}/${toFetch.length}] ${title.slice(0, 40)}... `);
    try {
      await sleep(DELAY_MS);
      const html = await fetchHtml(url);
      const recipe = parseRecipeDetail(html, url);
      if (!recipe.name) recipe.name = title;

      const id = url.match(/\/recept\/([a-zA-Z0-9]+)\//)?.[1] || `recepty-${Date.now()}-${i}`;
      const doc = { ...recipe };
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

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  module.exports = {
    BASE,
    DELAY_MS,
    STORAGE_BUCKET,
    fetchHtml,
    parseListing,
    parseRecipeDetail,
    uploadRecipeImage,
    sleep,
  };
}
