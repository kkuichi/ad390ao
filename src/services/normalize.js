// Normalizácia názvov, mapovanie na doc ID v prices (INGR_DICTIONARY), balenia (PACK_SIZES).
export function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toSlugForPrice(s) {
  if (!s || typeof s !== 'string') return '';
  const withSpaces = s.replace(/_/g, ' ');
  return normalizeName(withSpaces)
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
}

// Receptová ingrediencia (slug) → doc ID v kolekcii prices.
export const INGR_DICTIONARY = {
  // === HYDINA ===
  kura: 'kurca_bez_drobov_kg',
  kurca: 'kurca_bez_drobov_kg',
  cele_kura: 'kurca_bez_drobov_kg',
  cele_kurca: 'kurca_bez_drobov_kg',
  kuracie_maso: 'kuracie_rezne_kg',
  kuracie_prsia: 'kuracie_prsne_kg',
  kuracie_prsne: 'kuracie_prsne_kg',
  kuracie_rezne: 'kuracie_rezne_kg',
  kuracie_stehna: 'kuracie_stehna_bez_kg',
  kuracie_stehno: 'kuracie_stehno_kg',

  // === HOVÄDZIE ===
  hovadzie_maso: 'hovadzie_zadne_bez_kg',
  hovadzie: 'hovadzie_zadne_bez_kg',
  mlete_hovadzie_maso: 'mlete_maso_kg',
  mlete_maso: 'mlete_maso_kg',
  mlete_maso_zmes_hovadzie_a_bravcove: 'mlete_maso_kg',
  hovadzi_gulas: 'hovadzie_na_gulas_kg',
  hovadzie_na_gulas: 'hovadzie_na_gulas_kg',
  hovadzie_stehno: 'hovadzie_stehno_bez_kg',
  hovadzie_rebro: 'hovadzie_rebro_kostou_kg',
  svieckova: 'hovadzia_falosna_svieckova_kg',

  // === BRAVČOVÉ ===
  bravcove_maso: 'bravcove_plece_kg',
  bravcove: 'bravcove_plece_kg',
  bravcova_krkovicka: 'bravcova_krkovicka_bez_kg',
  krkovicka: 'bravcova_krkovicka_bez_kg',
  bravcove_kare: 'bravcove_kare_bez_kg',
  bravcove_stehno: 'bravcove_stehno_kg',
  bravcove_plece: 'bravcove_plece_kg',
  slanina: 'slanina_kg',
  sunka: 'sunka_kg',
  klobasa: 'klobasa_kg',

  // === RYBY ===
  losos: 'losos_kg',
  tuniak: 'tuniak_konzerva_ks',
  treska: 'treska_kg',

  // === MLIEČNE ===
  mlieko: 'mlieko_l',
  maslo: 'maslo_kg',
  eidam: 'eidam_kg',
  syr: 'eidam_kg',
  syr_eidam: 'eidam_kg',
  feta: 'feta_kg',
  syr_feta: 'feta_kg',
  parmezan: 'parmezan_kg',
  mozzarella: 'mozzarella_kg',
  smotana: 'smotana_l',
  smotana_na_varenie: 'smotana_l',
  slahacka: 'slahacka_l',
  slahackova_smotana: 'slahacka_l',
  jogurt: 'jogurt_kg',
  tvaroh: 'tvaroh_kg',
  cottage_cheese: 'cottage_cheese_kg',

  // === VAJCIA ===
  vajce: 'vajcia_ks',
  vajcia: 'vajcia_ks',
  vajko: 'vajcia_ks',

  // === MÚKA, CUKOR ===
  muka: 'muka_kg',
  muka_hladka: 'muka_kg',
  muka_polohruba: 'muka_kg',
  cukor: 'cukor_kg',
  cukor_krystalovy: 'cukor_kg',
  praskovy_cukor: 'belbake_praskovy_cukor_kg',

  // === OLEJE ===
  olej: 'olej_slnecnicovy_l',
  olej_slnecnicovy: 'olej_slnecnicovy_l',
  slnecnicovy_olej: 'olej_slnecnicovy_l',
  olivovy_olej: 'olej_olivovy_l',
  olej_olivovy: 'olej_olivovy_l',
  repkovy_olej: 'olej_repkovy_l',

  // === KORENINY ===
  sol: 'sol_kg',
  cierne_korenie: 'cierne_korenie_kg',
  mlete_cierne_korenie: 'cierne_korenie_kg',
  korenie: 'cierne_korenie_kg',
  paprika_mleta: 'mleta_paprika_kg',
  mleta_paprika: 'mleta_paprika_kg',
  sladka_paprika: 'mleta_paprika_kg',
  rasca: 'rasca_kg',
  mleta_rasca: 'rasca_kg',
  oregano: 'oregano_kg',
  bazalka: 'bazalka_kg',
  tymian: 'tymian_kg',
  kurkuma: 'kurkuma_kg',
  bobkovy_list: 'bobkovy_list_kg',
  nove_korenie: 'nové_korenie_kg',
  majoranka: 'majoranka_kg',

  // === ZELENINA ===
  zemiaky: 'zemiaky_konzumne_varny_kg',
  zemiak: 'zemiaky_konzumne_varny_kg',
  zemiaky_konzumne: 'zemiaky_konzumne_varny_kg',
  cibula: 'cibula_kg',
  cibula_zlta: 'cibula_kg',
  cesnak: 'cesnak_kg',
  cesnak_strucik: 'cesnak_strucik_ks',
  strucik_cesnaku: 'cesnak_strucik_ks',
  struciky_cesnaku: 'cesnak_strucik_ks',
  paradajky: 'paradajky_kg',
  paradajka: 'paradajky_kg',
  vacsie_paradajky: 'paradajky_kg',
  cherry_paradajky: 'paradajky_kg',
  paprika: 'paprika_kg',
  paprika_cervena: 'paprika_kg',
  mrkva: 'mrkva_kg',
  petrzlen: 'petrzlen_kg',
  petrzlenova_vnat: 'petrzlenova_vnat_ks',
  porik: 'porizek_kg',
  uhorka: 'uhorka_ks',
  salat: 'salat_ks',
  brokolica: 'brokolica_kg',
  karfiol: 'karfiol_kg',
  hrasok: 'hrasok_kg',
  kukurica: 'kukurica_kg',
  spenat: 'spinat_kg',
  sampiony: 'hriby_kg',
  hriby: 'hriby_kg',

  // === OVOCIE ===
  jablko: 'cervene_jablka_kg',
  jablka: 'cervene_jablka_kg',
  citron: 'citron_ks',
  limetka: 'limetka_ks',
  banan: 'banan_kg',
  pomaranc: 'pomaranc_kg',

  // === PEČIVO ===
  chlieb: 'chlieb_kg',
  rozok: 'rozok_kg',

  // === RYŽA, CESTOVINY ===
  ryza: 'ryza_kg',
  ryza_biela: 'ryza_kg',
  cestoviny: 'cestoviny_kg',
  spagety: 'spagety_kg',
  penne: 'penne_kg',
  sosovica: 'sosovica_kg',
  fazula: 'fazula_kg',
  cicer: 'cicitka_kg',

  // === KONZERVY, OMÁČKY ===
  passata: 'passata_l',
  paradajkovy_pretlak: 'paradajkovy_pretlak_kg',
  kecup: 'kecup_kg',
  horcica: 'horcica_kg',
  sojova_omacka: 'sojova_omacka_l',
  sojova: 'sojova_omacka_l',
  worcester: 'worcestrova_omacka_l',
  worcestrova: 'worcestrova_omacka_l',
  worcestrova_omacka: 'worcestrova_omacka_l',
  worcester_omacka: 'worcestrova_omacka_l',
  worchester: 'worcestrova_omacka_l',
  worchesterska: 'worcestrova_omacka_l',
  worchesterska_omacka: 'worcestrova_omacka_l',
  worcestershire: 'worcestrova_omacka_l',
  ocot: 'ocot_l',
  med: 'med_kg',
  drozdze: 'drozdze_ks',
  prasok_do_peciva: 'prasok_do_peciva_ks',
  jedla_soda: 'jedla_soda_kg',
  soda: 'jedla_soda_kg',
  soda_bikarbona: 'jedla_soda_kg',
  bikarbona: 'jedla_soda_kg',
  vanilkovy_cukor: 'vanilkovy_cukor_ks',
  kakao: 'kakao_kg',
  cokolada: 'cokolada_kg',

  // === SMOTANY (doplnenie) ===
  kysla_smotana: 'kysla_smotana_kg',
  kyslá_smotana: 'kysla_smotana_kg',
};

export const UNIT_FACTORS = {
  g: { kg: 0.001, g: 1 },
  kg: { g: 1000, kg: 1 },
  ml: { l: 0.001, ml: 1 },
  l: { ml: 1000, l: 1 },
  ks: { ks: 1 },
};

// Cena v DB je za balenie (napr. 10 vajec).
export const PACK_SIZES = {
  vajcia: 10,
};

export const PIECE_WEIGHTS = {
  cibula: 120,
  vajcia: 55,
  vajce: 55,
  mrkva: 80,
  cesnak_strucik: 5,
  cesnak: 5,
  citron: 120,
  limetka: 80,
  jablko: 150,
  paradajky: 150,
  cherry_paradajky: 20,
  slanina: 10,
  rozok: 50,
  zazvor: 20,
  kura: 1500,
  cele_kura: 1500,
  kurca: 1500,
  zemiaky: 150,
  petrzlen: 100,
};

// Objem 1 ks pri produktoch účtovaných za liter (mlieko, olej…).
export const LIQUID_KS_DEFAULT_ML = {
  mlieko: 1000,
  mlieko_plnotucne: 1000,
  smotana: 250,
  smotana_na_varenie: 250,
  kysla_smotana: 200,
  jogurt: 150,
  ocot: 500,
  sojova_omacka: 150,
  worcestrova_omacka: 150,
  olej_slnecnicovy: 1000,
  olej_olivovy: 500,
};

export function canonicalUnit(nameCanonical) {
  if (!nameCanonical || typeof nameCanonical !== 'string') return 'ks';
  const lower = nameCanonical.toLowerCase();
  if (lower.endsWith('_kg') || lower.endsWith('_g')) return 'g';
  if (lower.endsWith('_l') || lower.endsWith('_ml')) return 'ml';
  if (lower.endsWith('_ks')) return 'ks';
  return 'ks';
}

export function getCanonicalName(ingredientName) {
  const slug = toSlugForPrice(ingredientName);
  if (INGR_DICTIONARY[slug]) return INGR_DICTIONARY[slug];

  const parts = slug.split('_');
  for (let len = parts.length - 1; len >= 1; len--) {
    const sub = parts.slice(0, len).join('_');
    if (INGR_DICTIONARY[sub]) return INGR_DICTIONARY[sub];
  }
  if (parts.length > 0 && INGR_DICTIONARY[parts[0]]) return INGR_DICTIONARY[parts[0]];

  return slug;
}

export default {
  normalizeName,
  toSlugForPrice,
  INGR_DICTIONARY,
  canonicalUnit,
  UNIT_FACTORS,
  PACK_SIZES,
  PIECE_WEIGHTS,
  LIQUID_KS_DEFAULT_ML,
  getCanonicalName,
};
