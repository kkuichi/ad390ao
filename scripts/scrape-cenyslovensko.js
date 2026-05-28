#!/usr/bin/env node
// CenySlovensko.sk -> Firestore prices (najlacnejšia ponuka + predajne)
// USE_PUPPETEER=1 WRITE_FIRESTORE=1, CLEAR_PRICES_BEFORE=1 vymaže staré záznamy

const BASE = 'https://www.cenyslovensko.sk';
const DELAY_MS = parseInt(process.env.DELAY_MS || '1500', 10);

const CATEGORY_URLS = [
  `${BASE}/kategoria/1/chlieb-a-pecivo`,
  `${BASE}/kategoria/2/mliecne-vyrobky-a-vajcia`,
  `${BASE}/kategoria/3/maso-a-masove-vyrobky`,
  `${BASE}/kategoria/4/zelenina-a-ovocie`,
  `${BASE}/kategoria/5/trvanlive-potraviny-a-jedla`,
  `${BASE}/kategoria/6/specialne-potraviny`,
];

function normalizeNameForKey(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+/, '');
}

// Short product type from full name for deduplication (keeps variety, merges obvious duplicates).
function productNameToType(fullName) {
  const n = (fullName || '').trim();
  if (!n) return '';
  const lower = n.toLowerCase();
  let t = lower.replace(/\s*\d+%?\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const brandFirst = /^(pilos|mäsiarov|mäsiarova|lidl|kaufland|tesco|billa|globus|dm)\s+/i;
  t = t.replace(brandFirst, '').trim();
  if (/^maslo|máslo/i.test(t)) return 'Maslo';
  if (/^mlieko|mléko/i.test(t)) return 'Mlieko';
  if (/vajc|vajce/i.test(t)) return 'Vajcia';
  if (/^chlieb\s|chleba\s|chlieb$/i.test(t)) return 'Chlieb';
  if (/^muka|múka/i.test(t)) return 'Múka';
  if (/^cukor/i.test(t)) return 'Cukor';
  const skip = /\b(bloček|bločok|plátky|platky|strúhaný|plnotučný|tuku|g|kg|%\d*)\b/gi;
  const words = t.split(/\s+/).filter((w) => w.length > 1 && !skip.test(w));
  if (words.length >= 3) return words.slice(0, 3).join(' ').slice(0, 50);
  if (words.length >= 2) return words.slice(0, 2).join(' ').slice(0, 50);
  if (words.length === 1) return words[0].slice(0, 50);
  const raw = t.slice(0, 50) || fullName.slice(0, 50);
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function capitalizeName(s) {
  if (!s || typeof s !== 'string') return s;
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Parse price from strings like "1,42 €", "2,65 – 2,95 €", "7,10 €/kg".
function parsePriceEur(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  const single = t.match(/(\d+)[,.](\d{2})\s*€/);
  if (single) return parseFloat(single[1] + '.' + single[2]);
  const range = t.match(/(\d+)[,.](\d{2})\s*–\s*[\d,.]+\s*€/);
  if (range) return parseFloat(range[1] + '.' + range[2]);
  const whole = t.match(/(\d+)\s*€/);
  if (whole) return parseFloat(whole[1]);
  return null;
}

// Unit for pricing: kg, l, or ks from quantity label text.
function parseUnitFromQuantity(text) {
  if (!text || typeof text !== 'string') return 'ks';
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  if (/\bkg\b|(\d+)\s*g\b/.test(t)) return 'kg';
  if (/\bl\b|(\d+)\s*ml\b/.test(t)) return 'l';
  if (/\bks\b|\bkus\b/.test(t)) return 'ks';
  return 'kg';
}

// Parse category page HTML: product cards with store blocks and prices.
function parseCategoryHtml(html, sourceUrl = '') {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const results = [];

  $('.sc-iyBeIh.leFjPv').each((_, cardEl) => {
    const $card = $(cardEl);
    const nameEl = $card.find('a.sc-kCuUfV.jpHnRk strong').first();
    const productName = nameEl.text().replace(/\s+/g, ' ').trim();
    if (!productName) return;

    const unitLabel = $card.find('p[aria-label*="Množstevná jednotka"]').first().text().replace(/\s+/g, ' ').trim();
    const unit = parseUnitFromQuantity(unitLabel);

    $card.find('.sc-fmLCLE.dSypTA .sc-jIDBmd.OtjEw').each((_, storeBlock) => {
      const $block = $(storeBlock);
      const storeEl = $block.find('.sc-gDzyrw.vWdsN span.sc-dntSTA.jZKHsE').first();
      const storeName = storeEl.text().trim() || $block.find('img[alt*="Logo predajcu"]').attr('alt')?.replace(/Logo predajcu\s*/i, '').trim() || '';
      if (!storeName) return;

      const priceText = $block.find('p.sc-dntSTA.jZKHsE strong').first().text().replace(/\s+/g, ' ').trim();
      let priceEur = parsePriceEur(priceText);
      if (priceEur == null) {
        const unitPriceText = $block.find('p.sc-jvKoal.keKJSa').first().text().replace(/\s+/g, ' ').trim();
        priceEur = parsePriceEur(unitPriceText);
      }
      if (priceEur == null || priceEur <= 0) return;

      const unitPriceText = $block.find('p.sc-jvKoal.keKJSa').first().text();
      if (unitPriceText && unitPriceText.includes('€/kg')) {
        const perKg = parsePriceEur(unitPriceText);
        if (perKg != null) priceEur = perKg;
      }

      results.push({
        productName,
        name: productNameToType(productName) || productName.slice(0, 50),
        unit,
        priceEur: Math.round(priceEur * 100) / 100,
        store: storeName.slice(0, 30),
        source: sourceUrl,
      });
    });
  });

  return results;
}

// Merge raw rows by (name, unit): lowest price plus per-store offers.
function aggregateByTypeAndUnit(rawItems) {
  const byKey = new Map();
  for (const item of rawItems) {
    const name = (item.name || item.productName || '').trim() || 'Produkt';
    const unit = (item.unit || 'ks').toLowerCase();
    const key = `${normalizeNameForKey(name)}_${unit}`;

    const displayName = capitalizeName(name);
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: displayName,
        nameNormalized: normalizeNameForKey(name),
        unit,
        priceEur: item.priceEur,
        offers: [{ store: item.store, priceEur: item.priceEur }],
        source: item.source,
      });
      continue;
    }
    const rec = byKey.get(key);
    if (item.priceEur < rec.priceEur) rec.priceEur = item.priceEur;
    const existing = rec.offers.find((o) => o.store === item.store);
    if (existing) {
      if (item.priceEur < existing.priceEur) existing.priceEur = item.priceEur;
    } else {
      rec.offers.push({ store: item.store, priceEur: item.priceEur });
    }
  }
  for (const rec of byKey.values()) {
    rec.offers.sort((a, b) => a.priceEur - b.priceEur);
    if (rec.offers.length > 10) rec.offers = rec.offers.slice(0, 10);
  }
  return Array.from(byKey.values());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_PAGES_PER_CATEGORY = parseInt(process.env.MAX_PAGES_PER_CATEGORY || '500', 10);

async function getPaginationState(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Stránkovanie"]');
    if (!nav) return { current: 1, maxPage: 1, hasNav: false };
    const currentBtn = nav.querySelector('button[aria-current="page"]');
    const current = currentBtn
      ? parseInt(String(currentBtn.textContent || '').trim(), 10) || 1
      : 1;
    const labels = [...nav.querySelectorAll('button[aria-label^="Stránka"]')];
    let maxPage = current;
    for (const b of labels) {
      const m = (b.getAttribute('aria-label') || '').match(/Stránka (\d+)/);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
    }
    return { current, maxPage, hasNav: true };
  });
}

// Click next page in pagination nav; returns whether a click succeeded.
async function clickNextPaginationPage(page) {
  const clicked = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Stránkovanie"]');
    if (!nav) return false;

    const currentBtn = nav.querySelector('button[aria-current="page"]');
    const current = currentBtn
      ? parseInt(String(currentBtn.textContent || '').trim(), 10) || 1
      : 1;
    const nextNum = current + 1;

    const direct = nav.querySelector(`button[aria-label="Stránka ${nextNum}"]`);
    if (direct && !direct.disabled) {
      direct.click();
      return true;
    }

    const pageButtons = [...nav.querySelectorAll('button[aria-label^="Stránka"]')];
    const withNum = pageButtons
      .map((b) => {
        const m = (b.getAttribute('aria-label') || '').match(/Stránka (\d+)/);
        return m ? { n: parseInt(m[1], 10), el: b } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n);

    const nextEntry = withNum.find((x) => x.n === nextNum);
    if (nextEntry && !nextEntry.el.disabled) {
      nextEntry.el.click();
      return true;
    }

    const higher = withNum.filter((x) => x.n > current);
    if (higher.length) {
      const el = higher[0].el;
      if (!el.disabled) {
        el.click();
        return true;
      }
    }

    const allBtns = [...nav.querySelectorAll('button')];
    const byLabel = allBtns.find((b) => {
      const a = (b.getAttribute('aria-label') || '').toLowerCase();
      return /ďalš|dalsi|next|nasled/.test(a);
    });
    if (byLabel && !byLabel.disabled) {
      byLabel.click();
      return true;
    }

    const curIdx = allBtns.findIndex((b) => b.getAttribute('aria-current') === 'page');
    if (curIdx >= 0) {
      for (let i = curIdx + 1; i < allBtns.length; i++) {
        const b = allBtns[i];
        const t = (b.textContent || '').trim();
        if (/^\d+$/.test(t) && parseInt(t, 10) > current && !b.disabled) {
          b.click();
          return true;
        }
      }
    }

    return false;
  });
  return clicked;
}

async function scrapeCategoryAllPages(page, categoryUrl) {
  const items = [];
  let pagesScraped = 0;

  while (true) {
    const html = await page.content();
    const batch = parseCategoryHtml(html, categoryUrl);
    items.push(...batch);
    pagesScraped += 1;

    const state = await getPaginationState(page);
    if (!state.hasNav) {
      console.error(`${categoryUrl}: ${items.length} položiek (1 stránka)`);
      return items;
    }

    if (state.current >= state.maxPage) {
      console.error(
        `[OK] ${categoryUrl} -> ${items.length} položiek, stránky 1–${state.maxPage} (${pagesScraped} stránok)`,
      );
      return items;
    }

    if (pagesScraped >= MAX_PAGES_PER_CATEGORY) {
      console.error(
        `[WARN] ${categoryUrl}: dosiahnutý limit MAX_PAGES_PER_CATEGORY=${MAX_PAGES_PER_CATEGORY} (scrapnuté stránky: ${pagesScraped}).`,
      );
      return items;
    }

    const before = state.current;
    await sleep(DELAY_MS);
    const ok = await clickNextPaginationPage(page);
    if (!ok) {
      console.error(
        `[WARN] ${categoryUrl}: nepodarilo sa prekliknúť na stránku ${before + 1} (max v UI: ${state.maxPage}).`,
      );
      return items;
    }

    try {
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 25000 });
    } catch (_) {
      // network idle timeout is ok for SPA
    }
    await sleep(600);

    const afterState = await getPaginationState(page);
    if (afterState.current === before) {
      console.error(`${categoryUrl}: stránka sa nezmenila, končím pagináciu`);
      return items;
    }
  }
}

async function scrapeWithPuppeteer() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (_) {
    console.error('Puppeteer nie je nainštalovaný. Spusti: npm install puppeteer --save-dev');
    process.exit(1);
  }
  const browser = await puppeteer.launch({ headless: true });
  const allRaw = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1000);
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find((b) => b.textContent && b.textContent.includes('Prijať všetky'));
      if (btn) btn.click();
    });
    await sleep(1500);

    for (const url of CATEGORY_URLS) {
      try {
        await sleep(DELAY_MS);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(800);
        const items = await scrapeCategoryAllPages(page, url);
        allRaw.push(...items);
      } catch (err) {
        console.error(`preskočené ${url}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return aggregateByTypeAndUnit(allRaw);
}

const FIRESTORE_BATCH_SIZE = 500;

async function clearPricesCollection(db, collectionName) {
  const ref = db.collection(collectionName);
  let deleted = 0;
  let snapshot = await ref.limit(100).get();
  while (!snapshot.empty) {
    const batch = db.batch();
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snapshot.size;
    snapshot = await ref.limit(100).get();
  }
  return deleted;
}

async function writeToFirestore(products, clearBefore = false) {
  let firebaseAdmin;
  try {
    firebaseAdmin = require('firebase-admin');
  } catch (_) {
    console.error('Pre zápis do Firestore nainštaluj: npm install firebase-admin');
    return;
  }
  if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({ projectId: 'mealbuddy-ba30f' });
  }
  const db = firebaseAdmin.firestore();
  const now = firebaseAdmin.firestore.Timestamp.now();
  const COLLECTION = 'prices';

  if (clearBefore) {
    const deleted = await clearPricesCollection(db, COLLECTION);
    console.error(`Vymazaných ${deleted} starých záznamov v kolekcii "${COLLECTION}".`);
  }

  for (let i = 0; i < products.length; i += FIRESTORE_BATCH_SIZE) {
    const chunk = products.slice(i, i + FIRESTORE_BATCH_SIZE);
    const batch = db.batch();
    for (const p of chunk) {
      const docId = `${p.nameNormalized}_${(p.unit || 'ks').toLowerCase()}`;
      const ref = db.collection(COLLECTION).doc(docId);
      batch.set(ref, {
        name: p.name,
        nameNormalized: p.nameNormalized,
        unit: (p.unit || 'ks').toLowerCase(),
        priceEur: p.priceEur,
        updatedAt: now,
        source: p.source || 'cenyslovensko',
        offers: (p.offers || []).slice(0, 10),
      }, { merge: true });
    }
    await batch.commit();
  }
  console.log(`Do Firestore prices uložených ${products.length} dokumentov.`);
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const writeFirestore = process.env.WRITE_FIRESTORE === '1';
  const clearBefore = process.env.CLEAR_PRICES_BEFORE === '1';
  const outJson = process.env.OUT_JSON;

  console.error('Spúšťam scraper cien...');
  const products = await scrapeWithPuppeteer();

  console.error(`Po zlúčení: ${products.length} typov produktov`);

  if (outJson) {
    const fs = require('fs');
    fs.writeFileSync(outJson, JSON.stringify(products, null, 2), 'utf8');
    console.log(`Uložené do ${outJson}`);
  }

  if (products.length > 0 && writeFirestore && !dryRun) {
    await writeToFirestore(products, clearBefore);
  } else if (dryRun && products.length > 0) {
    console.log('Ukážka (prvých 10):');
    products.slice(0, 10).forEach((p) => {
      const offersStr = (p.offers || []).map((o) => `${o.store}: ${o.priceEur} €`).join(', ');
      console.log(`  ${p.name} | ${p.unit} | ${p.priceEur} € | ${offersStr}`);
    });
  }

  if (products.length === 0) {
    console.error('Nenašli sa žiadne ceny. Skontroluj, či stránka cenyslovensko.sk nezmenila štruktúru.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
