// Lacnejšie náhrady z Firestore cheaper_alternatives (+ malý fallback slovník).

import { findBestOffer } from './getPrice';
import { normalizeName, getCanonicalName } from '../normalize';
import { getCheaperAlternativesDoc } from '../firestore/cheaperAlternatives';

// @type {Record<string, Array<{alt: string, note: string}>>}

const FALLBACK_ALTERNATIVES = {
  olej_olivovy: [{ alt: 'olej_slnecnicovy', note: 'Slnečnicový olej je lacnejší' }],
  parmezan: [{ alt: 'eidam', note: 'Eidam je lacnejší' }],
  losos: [{ alt: 'treska_mrazena', note: 'Mrazená treska je lacnejšia' }],
  kysla_smotana: [{ alt: 'mlieko', note: 'Mlieko + trocha masla' }],
  javorovy_sirop: [{ alt: 'med', note: 'Med alebo cukor' }],
  cherry_paradajky: [{ alt: 'paradajky', note: 'Bežné paradajky' }],
  sparlga: [{ alt: 'zelene_fazulky', note: 'Zelená fazuľa' }],
  maslo: [{ alt: 'olej_slnecnicovy', note: 'Časť masla vie nahradiť olej' }],
  mozzarella: [{ alt: 'eidam', note: 'Eidam je často lacnejší' }],
  mascarpone: [{ alt: 'tvaroh', note: 'Tvaroh je lacnejšia alternatíva' }],
  rukola: [{ alt: 'spenat', note: 'Špenát je lacnejší listový základ' }],
  hovadzie_maso: [{ alt: 'morcacie_maso', note: 'Morčacie býva lacnejšie' }],
  bravcove_maso: [{ alt: 'kuracie_maso', note: 'Kuracie býva lacnejšie' }],
  cicer: [{ alt: 'sosovica', note: 'Šošovica je lacná strukovina' }],
  smotana_na_varenie: [{ alt: 'mlieko', note: 'Mlieko so zahustením je lacnejšie' }],
  biely_jogurt: [{ alt: 'kysla_smotana', note: 'Kyslá smotana býva lacnejšia' }],
};

const GENERIC_FALLBACK_PATTERNS = [
  { test: (n) => n.includes('olivovy_olej'), alt: 'olej_slnecnicovy', note: 'Slnečnicový olej je lacnejší' },
  { test: (n) => n.includes('smotana'), alt: 'mlieko', note: 'Mlieko + zahustenie býva lacnejšie' },
  { test: (n) => n.includes('syr'), alt: 'eidam', note: 'Eidam je často lacnejší syr' },
  { test: (n) => n.includes('losos'), alt: 'treska_mrazena', note: 'Mrazená treska je lacnejšia ryba' },
  { test: (n) => n.includes('sirup'), alt: 'med', note: 'Med alebo cukor je lacnejší' },
  { test: (n) => n.includes('cherry') && n.includes('paradaj'), alt: 'paradajky', note: 'Bežné paradajky sú lacnejšie' },
  { test: (n) => n.includes('cicer'), alt: 'sosovica', note: 'Šošovica je lacnejšia strukovina' },
];

// Odstráni "_kg/_l/_ks/_g/_ml" suffix z doc ID, aby vznikol slug pre lookup.

function stripUnitSuffix(s) {
  return String(s || '').replace(/_(kg|g|l|ml|ks)$/, '');
}


export async function findCheaperAlternative(nameNorm, prefer, uid) {
  if (!nameNorm) return null;

  const currentOffer = await findBestOffer(nameNorm, prefer, uid);
  if (!currentOffer) return null;

  // Firestore cache
  //    Kľúč = canonical doc ID, napr. "parmezan_kg".
  const canonicalId = getCanonicalName(nameNorm);
  const altsDoc = canonicalId ? await getCheaperAlternativesDoc(canonicalId) : null;

  // @type {Array<{alt: string, note: string}>}

  let candidates = [];
  if (altsDoc?.alternatives?.length) {
    candidates = altsDoc.alternatives.map((a) => ({
      alt: stripUnitSuffix(a.altDocId),
      note: a.reason || `${a.altName} je lacnejšia alternatíva`,
    }));
  } else {
    // 2) Fallback na ručnú mapu, ak Firestore zatiaľ nič nemá.
    const fallback = FALLBACK_ALTERNATIVES[nameNorm];
    if (fallback?.length) {
      candidates = fallback;
    } else {
      const generic = GENERIC_FALLBACK_PATTERNS.find((p) => p.test(nameNorm));
      if (generic) candidates = [{ alt: generic.alt, note: generic.note }];
    }
  }

  if (candidates.length === 0) return null;

  // Vyber tú alternatívu, ktorá pri aktuálnych cenách prináša najväčšiu úsporu.
  let best = null;
  for (const cand of candidates) {
    const altOffer = await findBestOffer(cand.alt, prefer, uid);
    if (!altOffer) continue;
    if (currentOffer.unitBase !== altOffer.unitBase) continue;

    const saveEur = currentOffer.pricePerBase - altOffer.pricePerBase;
    if (!Number.isFinite(saveEur) || saveEur <= 0) continue;

    if (!best || saveEur > best.saveEur) {
      best = {
        alt: cand.alt,
        note: cand.note,
        saveEur: Math.round(saveEur * 100) / 100,
        store: altOffer.store,
      };
    }
  }

  return best;
}


export async function findCheaperAlternativesForRecipe(ingredients, prefer, uid) {
  const suggestions = [];
  const seen = new Set();

  for (const ing of ingredients || []) {
    const name = typeof ing === 'string' ? ing : ing?.name || '';
    if (!name) continue;

    const nameNorm = normalizeName(name);
    if (!nameNorm || seen.has(nameNorm)) continue;
    seen.add(nameNorm);

    const alt = await findCheaperAlternative(nameNorm, prefer, uid);
    if (!alt) continue;

    suggestions.push({
      name,
      replace: nameNorm,
      with: alt.alt,
      note: alt.note,
      saveEur: alt.saveEur,
      store: alt.store,
    });
  }

  return suggestions.sort((a, b) => b.saveEur - a.saveEur);
}

export default {
  findCheaperAlternative,
  findCheaperAlternativesForRecipe,
};
