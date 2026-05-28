// Ceny ingrediencií: slovník → token match v prices → cache ingredient_price_mappings.
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import {
  normalizeName,
  getCanonicalName,
  toSlugForPrice,
  PIECE_WEIGHTS,
  PACK_SIZES,
  LIQUID_KS_DEFAULT_ML,
} from './normalize';
import { matchIngredientToProduct } from './llm/ingredientMatcher';
import { getUserPriceOverridesMap } from './firestore/priceOverrides';

const COLLECTION = 'prices';

// Používateľský override ceny za rovnakú jednotku ako v dokumente `prices`.

function applyUserPriceOverride(offer, priceDocId, overrides) {
  if (!offer || !priceDocId || !overrides) return offer;
  const o = overrides[priceDocId];
  const p = o && Number(o.priceEur);
  if (!Number.isFinite(p) || p <= 0) return offer;
  return {
    ...offer,
    priceEur: Math.round(p * 10000) / 10000,
    store: typeof o.storeLabel === 'string' && o.storeLabel.trim() ? o.storeLabel.trim() : 'Vlastné',
    source: 'manual',
  };
}



function normalizeOfferUnit(unit) {
  const u = (unit || 'ks').toLowerCase().trim();
  if (u === 'kg') return { baseUnit: 'g', baseQty: 1000 };
  if (u === 'l') return { baseUnit: 'ml', baseQty: 1000 };
  if (u === 'g' || u === 'ml' || u === 'ks') return { baseUnit: u, baseQty: 1 };
  return { baseUnit: 'ks', baseQty: 1 };
}


function pickCheapestOffer(offers, preferredStore) {
  if (!offers || offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => (a.priceEur || Infinity) - (b.priceEur || Infinity));
  if (preferredStore) {
    const inStore = sorted.find(
      (o) => (o.store || '').toUpperCase() === preferredStore.toUpperCase(),
    );
    if (inStore) return inStore;
  }
  return sorted[0];
}

// Vytvorí BestOffer z dokumentu (data.unit je zdrojom pravdy pre jednotku).

function toBestOffer(data, chosenOffer, docId) {
  const { baseUnit, baseQty } = normalizeOfferUnit(data.unit);
  let adjustedBaseQty = baseQty;
  if (baseUnit === 'ks' && docId) {
    const stripped = docId.replace(/_(ks|kg|g|l|ml)$/, '');
    const packSize = PACK_SIZES[stripped];
    if (packSize > 1) adjustedBaseQty = packSize;
  }
  return {
    priceEur: Number(chosenOffer.priceEur) || 0,
    unit: baseUnit,
    store: chosenOffer.store || '',
    source: data.source || 'cenyslovensko',
    baseQty: adjustedBaseQty,
    // Pôvodná jednotka z cenníka (kg, l, g, …) – pre zaokrúhľovanie na balenia keď chýba packageSize

    rawUnit: String(data.unit || '').toLowerCase().trim(),
    packageSize: data.packageSize ?? chosenOffer.packageSize ?? null,
  };
}

// cache katalógu prices (TTL 15 min)

let _catalogCache = null;
let _catalogTimestamp = 0;
const CATALOG_TTL = 15 * 60 * 1000;
const _bestOfferCache = new Map();
const BEST_OFFER_TTL = 10 * 60 * 1000;

async function loadCatalog() {
  const now = Date.now();
  if (_catalogCache && now - _catalogTimestamp < CATALOG_TTL) return _catalogCache;
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    const rows = [];
    snap.forEach((d) => {
      const data = d.data();
      rows.push({
        id: d.id,
        name: data.name || '',
        nameNormalized: data.nameNormalized || '',
        unit: data.unit || 'ks',
        priceEur: data.priceEur,
        offers: Array.isArray(data.offers) ? data.offers : [],
        source: data.source || '',
      });
    });
    _catalogCache = rows;
    _catalogTimestamp = now;
    _tokenIndex = buildTokenIndex(rows);
    return rows;
  } catch (err) {
    if (__DEV__ && console?.warn) console.warn('[prices] loadCatalog failed:', err);
    return _catalogCache || [];
  }
}

export function clearCatalogCache() {
  _catalogCache = null;
  _catalogTimestamp = 0;
  _bestOfferCache.clear();
  _tokenIndex = null;
}

// token index: doc ID → indexy v katalógu

let _tokenIndex = null;

function buildTokenIndex(rows) {
  const idx = new Map();
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].id.replace(/_(kg|g|l|ml|ks)$/, '');
    const tokens = id.split('_').filter((t) => t.length > 1);
    for (const t of tokens) {
      if (!idx.has(t)) idx.set(t, []);
      idx.get(t).push(i);
    }
  }
  return idx;
}

// Nájde najlepší match z katalógu na základe spoločných tokenov.
// Preferuje kratšie doc IDs (generickejšie produkty) a viac matchujúcich tokenov.

function tokenBasedMatch(ingredientName, catalog, tokenIndex) {
  if (!tokenIndex || !catalog || catalog.length === 0) return null;

  const slug = toSlugForPrice(ingredientName).replace(/_(kg|g|l|ml|ks)$/, '');
  const queryTokens = slug.split('_').filter((t) => t.length > 1);
  if (queryTokens.length === 0) return null;

  const scoreMap = new Map();
  for (const qt of queryTokens) {
    const matches = tokenIndex.get(qt);
    if (!matches) continue;
    for (const idx of matches) {
      scoreMap.set(idx, (scoreMap.get(idx) || 0) + 1);
    }
  }

  if (scoreMap.size === 0) return null;

  let bestIdx = -1;
  let bestScore = 0;
  let bestIdLen = Infinity;

  for (const [idx, hitCount] of scoreMap) {
    const docIdLen = catalog[idx].id.length;
    const tokenCount = catalog[idx].id.replace(/_(kg|g|l|ml|ks)$/, '').split('_').filter((t) => t.length > 1).length;
    const coverage = hitCount / Math.max(queryTokens.length, tokenCount);

    if (coverage < 0.3) continue;

    if (hitCount > bestScore || (hitCount === bestScore && docIdLen < bestIdLen)) {
      bestScore = hitCount;
      bestIdx = idx;
      bestIdLen = docIdLen;
    }
  }

  if (bestIdx < 0) return null;
  return { docId: catalog[bestIdx].id, score: bestScore };
}

// slug kandidáti

const UNIT_SUFFIXES = ['_kg', '_g', '_l', '_ml', '_ks'];

function buildSlugCandidates(slug) {
  if (!slug) return [];
  const out = [slug];
  const hasUnit = UNIT_SUFFIXES.some((s) => slug.endsWith(s));
  if (!hasUnit) {
    for (const s of UNIT_SUFFIXES) out.push(slug + s);
  } else {
    const base = slug.replace(/_(kg|g|l|ml|ks)$/, '');
    if (base && base !== slug) {
      for (const s of UNIT_SUFFIXES) {
        const c = base + s;
        if (c !== slug && !out.includes(c)) out.push(c);
      }
    }
  }
  return out;
}

// Jednotka cenníka z override záznamu alebo z prípony doc ID (_kg, …).

function unitFromOverrideOrSlug(ovr, slug) {
  const u = ovr && ovr.unit && String(ovr.unit).toLowerCase().trim();
  if (u && ['kg', 'g', 'l', 'ml', 'ks'].includes(u)) return u;
  const m = String(slug || '').match(/_(kg|g|l|ml|ks)$/i);
  if (m) return m[1].toLowerCase();
  return 'ks';
}

// Ponuka len z profiles/.../priceOverrides (žiadny riadok v `prices`, alebo prázdne offers).

function syntheticOfferFromProfileOverride(slug, ovr) {
  if (!slug || !ovr) return null;
  const p = Number(ovr.priceEur);
  if (!Number.isFinite(p) || p <= 0) return null;
  const unitRaw = unitFromOverrideOrSlug(ovr, slug);
  return toBestOffer(
    { unit: unitRaw, source: ovr.isCustom ? 'manual-custom' : 'manual' },
    { priceEur: p, store: '' },
    slug,
  );
}

// getBestOfferFor

export async function getBestOfferFor(ingredientName, preferredStore, options = {}) {
  if (!ingredientName || typeof ingredientName !== 'string') return null;
  const allowFuzzy = options.allowFuzzy !== false;
  const uid = options.uid || null;
  const overrides =
    options.overrides != null
      ? options.overrides
      : uid
        ? await getUserPriceOverridesMap(uid)
        : {};

  const cacheKey = `${normalizeName(ingredientName)}|${(preferredStore || '').toUpperCase()}|${allowFuzzy ? 'fuzzy' : 'strict'}|${uid || ''}|ru1`;
  const cached = _bestOfferCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BEST_OFFER_TTL) return cached.value;

  // 1) Priamy slug cez INGR_DICTIONARY + varianty s unit suffixom
  const canonical = getCanonicalName(ingredientName);
  const slugCanonical = toSlugForPrice(canonical);

  const candidates = buildSlugCandidates(slugCanonical);
  const slugNorm = toSlugForPrice(normalizeName(ingredientName));
  if (slugNorm && slugNorm !== slugCanonical) {
    for (const c of buildSlugCandidates(slugNorm)) {
      if (!candidates.includes(c)) candidates.push(c);
    }
  }

  for (const slug of candidates) {
    const hit = await tryDirectLookup(slug, preferredStore);
    if (hit) {
      const wrapped = applyUserPriceOverride(hit, slug, overrides);
      _bestOfferCache.set(cacheKey, { ts: Date.now(), value: wrapped });
      return wrapped;
    }
    const synOnly = syntheticOfferFromProfileOverride(slug, overrides[slug]);
    if (synOnly) {
      const wrapped = applyUserPriceOverride(synOnly, slug, overrides);
      _bestOfferCache.set(cacheKey, { ts: Date.now(), value: wrapped });
      return wrapped;
    }
  }

  if (!allowFuzzy) {
    _bestOfferCache.set(cacheKey, { ts: Date.now(), value: null });
    return null;
  }

  // 3) Token-based match cez katalóg (rýchlejší ako fuzzy)
  const catalog = await loadCatalog();
  const match = tokenBasedMatch(ingredientName, catalog, _tokenIndex);
  if (!match) {
    _bestOfferCache.set(cacheKey, { ts: Date.now(), value: null });
    return null;
  }

  const row = catalog.find((r) => r.id === match.docId);
  if (!row) {
    _bestOfferCache.set(cacheKey, { ts: Date.now(), value: null });
    return null;
  }

  if (!row.offers || row.offers.length === 0) {
    const syn = syntheticOfferFromProfileOverride(match.docId, overrides[match.docId]);
    if (syn) {
      const wrapped = applyUserPriceOverride(syn, match.docId, overrides);
      _bestOfferCache.set(cacheKey, { ts: Date.now(), value: wrapped });
      return wrapped;
    }
    _bestOfferCache.set(cacheKey, { ts: Date.now(), value: null });
    return null;
  }

  const chosen = pickCheapestOffer(row.offers, preferredStore);
  if (!chosen) {
    _bestOfferCache.set(cacheKey, { ts: Date.now(), value: null });
    return null;
  }

  const out = applyUserPriceOverride(toBestOffer(row, chosen, match.docId), match.docId, overrides);
  _bestOfferCache.set(cacheKey, { ts: Date.now(), value: out });
  return out;
}

async function tryDirectLookup(slug, preferredStore) {
  if (!slug) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, slug));
    if (!snap.exists()) return null;
    const data = snap.data();
    const offers = Array.isArray(data.offers) ? data.offers : [];
    if (offers.length === 0) return null;
    const chosen = pickCheapestOffer(offers, preferredStore);
    if (!chosen) return null;
    return toBestOffer(data, chosen, slug);
  } catch {
    return null;
  }
}

// hmotnosť ks (PIECE_WEIGHTS)

function lookupPieceWeight(canonical) {
  if (!canonical) return 0;
  const slug = toSlugForPrice(canonical).replace(/_(kg|g|l|ml|ks)$/, '');
  if (PIECE_WEIGHTS[slug]) return PIECE_WEIGHTS[slug];

  const parts = slug.split('_');
  for (let len = parts.length; len >= 1; len--) {
    const sub = parts.slice(0, len).join('_');
    if (PIECE_WEIGHTS[sub]) return PIECE_WEIGHTS[sub];
  }
  for (let i = 0; i < parts.length; i++) {
    if (PIECE_WEIGHTS[parts[i]]) return PIECE_WEIGHTS[parts[i]];
  }
  return 0;
}

// „1 ks“ tekutiny predávanej po ml/l – bežné balenie v ml (pozri LIQUID_KS_DEFAULT_ML).

function lookupLiquidKsDefaultMl(canonical) {
  if (!canonical) return 0;
  const slug = toSlugForPrice(canonical).replace(/_(kg|g|l|ml|ks)$/, '');
  if (LIQUID_KS_DEFAULT_ML[slug]) return LIQUID_KS_DEFAULT_ML[slug];
  const parts = slug.split('_');
  for (let len = parts.length; len >= 1; len--) {
    const sub = parts.slice(0, len).join('_');
    if (LIQUID_KS_DEFAULT_ML[sub]) return LIQUID_KS_DEFAULT_ML[sub];
  }
  for (let i = 0; i < parts.length; i++) {
    if (LIQUID_KS_DEFAULT_ML[parts[i]]) return LIQUID_KS_DEFAULT_ML[parts[i]];
  }
  return 0;
}

// convertQtyToOfferUnit

export function convertQtyToOfferUnit(qty, fromUnit, offerUnit, ingredientCanonical) {
  if (qty == null || !isFinite(qty) || qty <= 0) return 0;
  if (fromUnit === offerUnit) return qty;

  let qtyInBase = qty;
  let fromBase = fromUnit;
  if (fromUnit === 'kg') { qtyInBase = qty * 1000; fromBase = 'g'; }
  else if (fromUnit === 'l') { qtyInBase = qty * 1000; fromBase = 'ml'; }

  if (fromBase === offerUnit) return qtyInBase;

  if (fromBase === 'ks' && (offerUnit === 'g' || offerUnit === 'ml')) {
    const w = lookupPieceWeight(ingredientCanonical);
    if (w > 0) return qtyInBase * w;
    if (offerUnit === 'ml') {
      const liqMl = lookupLiquidKsDefaultMl(ingredientCanonical);
      if (liqMl > 0) return qtyInBase * liqMl;
    }
    return qtyInBase * 100;
  }

  if ((fromBase === 'g' || fromBase === 'ml') && offerUnit === 'ks') {
    const w = lookupPieceWeight(ingredientCanonical);
    if (w > 0) return qtyInBase / w;
    return qtyInBase;
  }

  return qtyInBase;
}

// estimateIngredientCost

const SKIP_UNITS = new Set([
  'podľa chuti', 'podle chuti', 'štipka', 'stipka', 'podla chuti', 'na ozdobu',
]);

export async function estimateIngredientCost(ingredient, profile, uid) {
  const name = ingredient?.name || '';
  const qty = ingredient?.qty ?? 1;
  const unit = (ingredient?.unit || 'ks').toLowerCase().trim();

  if (SKIP_UNITS.has(unit)) return { euro: 0 };

  const overrides = uid ? await getUserPriceOverridesMap(uid) : {};

  // 1) Skús klasický lookup (dictionary + token match)
  const offer = await getBestOfferFor(name, profile?.preferredStore, { uid, overrides });

  if (offer) {
    let qtyBase = qty;
    let baseUnit = unit;
    if (unit === 'polievková lyžica' || unit === 'pl' || unit === 'pl.') {
      qtyBase = qty * 15; baseUnit = 'ml';
    } else if (/^[čc]ajov[áa]\s*ly[žz]ic[aeu]$|^[čc]l\.?$/.test(unit)) {
      qtyBase = qty * 5; baseUnit = 'ml';
    } else if (unit === 'kg') {
      qtyBase = qty * 1000; baseUnit = 'g';
    } else if (unit === 'l') {
      qtyBase = qty * 1000; baseUnit = 'ml';
    } else if (unit === 'dcl') {
      qtyBase = qty * 100; baseUnit = 'ml';
    } else if (unit === 'hrnček' || unit === 'hrnok' || unit === 'šálka' || unit === 'salka') {
      qtyBase = qty * 250; baseUnit = 'ml';
    } else if (unit === 'g') {
      baseUnit = 'g';
    } else if (unit === 'ml') {
      baseUnit = 'ml';
    } else if (unit === 'ks' || unit === 'kus' || unit === 'kusy') {
      baseUnit = 'ks';
    } else {
      baseUnit = 'ks';
    }

    const canonical = getCanonicalName(name);
    const qtyInOfferUnit = convertQtyToOfferUnit(qtyBase, baseUnit, offer.unit, canonical);
    const euro = (qtyInOfferUnit / offer.baseQty) * offer.priceEur;

    return {
      euro: Math.round(euro * 100) / 100,
      matched: {
        store: offer.store,
        unit: offer.unit,
        priceEur: offer.priceEur,
        source: offer.source,
      },
    };
  }

  // 2) Klasický lookup zlyhal → skús predgenerovaný LLM cache
  try {
    const llmResult = await matchIngredientToProduct(
      { name, qty, unit: ingredient?.unit || 'ks' },
    );

    if (llmResult.matchedDocId && llmResult.confidence >= 0.4) {
      const catalog = await loadCatalog();
      const row = catalog.find((r) => r.id === llmResult.matchedDocId);
      if (row && row.offers.length > 0) {
        const chosen = pickCheapestOffer(row.offers, profile?.preferredStore);
        if (chosen) {
          const { baseUnit: offerBaseUnit, baseQty: offerBaseQty } = normalizeOfferUnit(row.unit);
          const ovr = overrides[row.id];
          const unitPrice =
            ovr && Number(ovr.priceEur) > 0 ? Number(ovr.priceEur) : Number(chosen.priceEur) || 0;
          const euro = (llmResult.qtyInProductUnit / offerBaseQty) * unitPrice;

          return {
            euro: Math.round(Math.abs(euro) * 100) / 100,
            matched: {
              store: ovr && Number(ovr.priceEur) > 0 ? 'Vlastné' : chosen.store || '',
              unit: offerBaseUnit,
              priceEur: unitPrice,
              source: ovr && Number(ovr.priceEur) > 0 ? 'manual' : 'llm-cache',
            },
          };
        }
      }
    }
  } catch (err) {
    if (__DEV__ && console?.warn) console.warn('[prices] LLM cache lookup failed:', err);
  }

  return { euro: 0 };
}

export default {
  getBestOfferFor,
  convertQtyToOfferUnit,
  estimateIngredientCost,
  clearCatalogCache,
};
