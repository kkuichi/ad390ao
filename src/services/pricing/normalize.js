// Normalizácia názvov a jednotiek ingrediencií pre ceny.


// Synonymá: normalizovaný názov → jednotný kľúč pre prices.

const SYNONYMS = {
  // Paradajky
  paradajka: 'paradajky',
  paradajky: 'paradajky',
  cherry_paradajky: 'paradajky',
  
  // Vajcia
  vajce: 'vajcia',
  vajko: 'vajcia',
  jajko: 'vajcia',
  jajka: 'vajcia',
  vajcia: 'vajcia',
  
  // Oleje
  olej: 'olej_slnecnicovy',
  'olej slnecnicovy': 'olej_slnecnicovy',
  'olej slnečnicový': 'olej_slnecnicovy',
  'olej olivovy': 'olej_olivovy',
  'olej olivový': 'olej_olivovy',
  'olivovy olej': 'olej_olivovy',
  
  // Cibuľa
  cibula: 'cibula',
  cibula_zlta: 'cibula',
  
  // Cesnak
  cesnak: 'cesnak',
  cesnak_strucik: 'cesnak',
  
  // Mrkva
  mrkva: 'mrkva',
  mensia_mrkva: 'mrkva',
  
  // Mlieko
  mlieko: 'mlieko',
  mlieko_plnotucne: 'mlieko',
  
  // Múka
  muka: 'muka_hladka',
  muka_hladka: 'muka_hladka',
  
  // Ryža
  ryza: 'ryza_biela',
  ryza_biela: 'ryza_biela',
  
  // Zemiaky
  zemiaky: 'zemiaky',
  zemiak: 'zemiaky',
};


export function normalizeName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  
  // Základná normalizácia
  let normalized = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // odstráni diakritiku
    .replace(/[^a-z0-9\s]/g, '') // odstráni interpunkciu
    .replace(/\s+/g, ' ')
    .trim();
  
  // Aplikuj synonymá
  const synonym = SYNONYMS[normalized];
  if (synonym) {
    normalized = synonym;
  }
  
  return normalized;
}


export function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'ks';
  
  const u = unit.trim().toLowerCase();
  
  // Hmotnosť
  if (u === 'g' || u === 'kg' || u === 'gram' || u === 'gramy') return 'g';
  
  // Objem
  if (u === 'ml' || u === 'l' || u === 'litr' || u === 'litre') return 'ml';
  
  // Kusy
  if (u === 'ks' || u === 'kus' || u === 'kusy' || u === 'kusov') return 'ks';
  
  // Špeciálne jednotky
  if (u === 'lyzicka' || u === 'lyžička' || u === 'čl' || u === 'cl' || u === 'čajová lyžica') return 'ml'; // 5ml
  if (u === 'polievkova lyzica' || u === 'polievková lyžica' || u === 'pl' || u === 'pl.') return 'ml'; // 15ml
  if (u === 'stipka' || u === 'štipka') return 'g'; // 1g
  if (u === 'hrncek' || u === 'hrnček' || u === 'hrnok') return 'ml'; // 250ml
  if (u === 'balenie' || u === 'bal') return null; // bude riešiť balíkový prevod
  
  // Vajcia → ks
  if (u.includes('vajc') || u.includes('jajk')) return 'ks';
  
  return 'ks'; // default
}


export function toBase(amount, unit) {
  return { qty: amount || 0, unit: unit || 'ks' };
}


export function convert(amount, from, to) {
  if (from === to) return amount;
  
  // Hmotnosť: g ↔ kg
  if (from === 'kg' && to === 'g') return amount * 1000;
  if (from === 'g' && to === 'kg') return amount / 1000;
  
  // Objem: ml ↔ l
  if (from === 'l' && to === 'ml') return amount * 1000;
  if (from === 'ml' && to === 'l') return amount / 1000;
  
  // ks sa neprevádza
  if (from === 'ks' || to === 'ks') return amount;
  
  return amount;
}


export function toNameNormalized(rawName) {
  const normalized = normalizeName(rawName);
  return normalized.replace(/\s+/g, '_');
}

export default {
  normalizeName,
  normalizeUnit,
  toBase,
  convert,
  toNameNormalized,
  SYNONYMS,
};
