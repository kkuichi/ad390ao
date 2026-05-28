#!/usr/bin/env node
// Doplní bežné suroviny do prices (orientačné ceny), ak tam ešte nie sú
// GOOGLE_APPLICATION_CREDENTIALS="...json" node scripts/seed-common-ingredients.js

const firebaseAdmin = require('firebase-admin');

if (!firebaseAdmin.apps.length) {
  firebaseAdmin.initializeApp({ projectId: 'mealbuddy-ba30f' });
}
const db = firebaseAdmin.firestore();
const now = firebaseAdmin.firestore.Timestamp.now();

const STAPLES = [
  { id: 'olej_slnecnicovy_l', name: 'Olej slnečnicový', unit: 'l', priceEur: 2.29, store: 'priemer' },
  { id: 'olej_olivovy_l', name: 'Olej olivový', unit: 'l', priceEur: 7.99, store: 'priemer' },
  { id: 'olej_repkovy_l', name: 'Olej repkový', unit: 'l', priceEur: 2.49, store: 'priemer' },
  { id: 'cibula_kg', name: 'Cibuľa', unit: 'kg', priceEur: 0.99, store: 'priemer' },
  { id: 'cesnak_kg', name: 'Cesnak', unit: 'kg', priceEur: 7.99, store: 'priemer' },
  { id: 'cesnak_strucik_ks', name: 'Cesnak strúčik', unit: 'ks', priceEur: 0.04, store: 'priemer' },
  { id: 'paradajky_kg', name: 'Paradajky', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'paprika_kg', name: 'Paprika', unit: 'kg', priceEur: 2.99, store: 'priemer' },
  { id: 'mrkva_kg', name: 'Mrkva', unit: 'kg', priceEur: 0.99, store: 'priemer' },
  { id: 'petrzlen_kg', name: 'Petržlen', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'petrzlenova_vnat_ks', name: 'Petržlenová vňať', unit: 'ks', priceEur: 0.49, store: 'priemer' },
  { id: 'porizek_kg', name: 'Pórik', unit: 'kg', priceEur: 2.99, store: 'priemer' },
  { id: 'uhorka_ks', name: 'Uhorka', unit: 'ks', priceEur: 0.69, store: 'priemer' },
  { id: 'salat_ks', name: 'Šalát hlávkový', unit: 'ks', priceEur: 0.99, store: 'priemer' },
  { id: 'brokolica_kg', name: 'Brokolica', unit: 'kg', priceEur: 2.99, store: 'priemer' },
  { id: 'karfiol_kg', name: 'Karfiol', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'hrasok_kg', name: 'Hrášok mrazený', unit: 'kg', priceEur: 2.29, store: 'priemer' },
  { id: 'kukurica_kg', name: 'Kukurica mrazená', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'spinat_kg', name: 'Špenát mrazený', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'hriby_kg', name: 'Šampióny', unit: 'kg', priceEur: 3.99, store: 'priemer' },
  { id: 'citron_ks', name: 'Citrón', unit: 'ks', priceEur: 0.39, store: 'priemer' },
  { id: 'limetka_ks', name: 'Limetka', unit: 'ks', priceEur: 0.49, store: 'priemer' },
  { id: 'banan_kg', name: 'Banán', unit: 'kg', priceEur: 1.49, store: 'priemer' },
  { id: 'pomaranc_kg', name: 'Pomaranč', unit: 'kg', priceEur: 1.99, store: 'priemer' },
  { id: 'sol_kg', name: 'Soľ', unit: 'kg', priceEur: 0.49, store: 'priemer' },
  { id: 'cierne_korenie_kg', name: 'Čierne korenie mleté', unit: 'kg', priceEur: 19.90, store: 'priemer' },
  { id: 'mleta_paprika_kg', name: 'Mletá paprika', unit: 'kg', priceEur: 9.90, store: 'priemer' },
  { id: 'rasca_kg', name: 'Rasca mletá', unit: 'kg', priceEur: 14.90, store: 'priemer' },
  { id: 'oregano_kg', name: 'Oregano sušené', unit: 'kg', priceEur: 24.90, store: 'priemer' },
  { id: 'bazalka_kg', name: 'Bazalka sušená', unit: 'kg', priceEur: 29.90, store: 'priemer' },
  { id: 'tymian_kg', name: 'Tymián sušený', unit: 'kg', priceEur: 29.90, store: 'priemer' },
  { id: 'kurkuma_kg', name: 'Kurkuma mletá', unit: 'kg', priceEur: 14.90, store: 'priemer' },
  { id: 'bobkovy_list_kg', name: 'Bobkový list', unit: 'kg', priceEur: 39.90, store: 'priemer' },
  { id: 'nové_korenie_kg', name: 'Nové korenie', unit: 'kg', priceEur: 19.90, store: 'priemer' },
  { id: 'majoranka_kg', name: 'Majoránka', unit: 'kg', priceEur: 24.90, store: 'priemer' },
  { id: 'ryza_kg', name: 'Ryža', unit: 'kg', priceEur: 1.49, store: 'priemer' },
  { id: 'cestoviny_kg', name: 'Cestoviny', unit: 'kg', priceEur: 1.19, store: 'priemer' },
  { id: 'spagety_kg', name: 'Špagety', unit: 'kg', priceEur: 1.19, store: 'priemer' },
  { id: 'penne_kg', name: 'Penne', unit: 'kg', priceEur: 1.29, store: 'priemer' },
  { id: 'sosovica_kg', name: 'Šošovica', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'fazula_kg', name: 'Fazuľa', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'cicitka_kg', name: 'Cícer', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'smotana_l', name: 'Smotana na varenie', unit: 'l', priceEur: 1.99, store: 'priemer' },
  { id: 'slahacka_l', name: 'Šľahačka', unit: 'l', priceEur: 3.49, store: 'priemer' },
  { id: 'jogurt_kg', name: 'Jogurt biely', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'tvaroh_kg', name: 'Tvaroh', unit: 'kg', priceEur: 4.99, store: 'priemer' },
  { id: 'feta_kg', name: 'Syr Feta', unit: 'kg', priceEur: 11.90, store: 'priemer' },
  { id: 'parmezan_kg', name: 'Parmezán', unit: 'kg', priceEur: 19.90, store: 'priemer' },
  { id: 'mozzarella_kg', name: 'Mozzarella', unit: 'kg', priceEur: 7.99, store: 'priemer' },
  { id: 'cottage_cheese_kg', name: 'Cottage cheese', unit: 'kg', priceEur: 5.99, store: 'priemer' },
  { id: 'passata_l', name: 'Passata (paradajkové pyré)', unit: 'l', priceEur: 1.49, store: 'priemer' },
  { id: 'paradajkovy_pretlak_kg', name: 'Paradajkový pretlak', unit: 'kg', priceEur: 3.99, store: 'priemer' },
  { id: 'kecup_kg', name: 'Kečup', unit: 'kg', priceEur: 2.99, store: 'priemer' },
  { id: 'horcica_kg', name: 'Horčica', unit: 'kg', priceEur: 2.99, store: 'priemer' },
  { id: 'sojova_omacka_l', name: 'Sójová omáčka', unit: 'l', priceEur: 4.99, store: 'priemer' },
  { id: 'worcestrova_omacka_l', name: 'Worcestrová omáčka', unit: 'l', priceEur: 5.49, store: 'priemer' },
  { id: 'ocot_l', name: 'Ocot', unit: 'l', priceEur: 0.99, store: 'priemer' },
  { id: 'med_kg', name: 'Med', unit: 'kg', priceEur: 9.99, store: 'priemer' },
  { id: 'drozdze_ks', name: 'Droždie', unit: 'ks', priceEur: 0.25, store: 'priemer' },
  { id: 'prasok_do_peciva_ks', name: 'Prášok do pečiva', unit: 'ks', priceEur: 0.19, store: 'priemer' },
  { id: 'jedla_soda_kg', name: 'Jedlá sóda (bikarbóna)', unit: 'kg', priceEur: 4.99, store: 'priemer' },
  { id: 'vanilkovy_cukor_ks', name: 'Vanilkový cukor', unit: 'ks', priceEur: 0.25, store: 'priemer' },
  { id: 'kakao_kg', name: 'Kakao', unit: 'kg', priceEur: 9.99, store: 'priemer' },
  { id: 'cokolada_kg', name: 'Čokoláda', unit: 'kg', priceEur: 7.99, store: 'priemer' },
  { id: 'kysla_smotana_kg', name: 'Kyslá smotana', unit: 'kg', priceEur: 2.49, store: 'priemer' },
  { id: 'zazvor_kg', name: 'Zázvor čerstvý', unit: 'kg', priceEur: 5.99, store: 'priemer' },
  { id: 'slanina_kg', name: 'Slanina', unit: 'kg', priceEur: 5.99, store: 'priemer' },
  { id: 'sunka_kg', name: 'Šunka', unit: 'kg', priceEur: 8.99, store: 'priemer' },
  { id: 'klobasa_kg', name: 'Klobása', unit: 'kg', priceEur: 6.99, store: 'priemer' },
  { id: 'mlete_maso_kg', name: 'Mleté mäso', unit: 'kg', priceEur: 5.49, store: 'priemer' },
  { id: 'losos_kg', name: 'Losos', unit: 'kg', priceEur: 14.99, store: 'priemer' },
  { id: 'tuniak_konzerva_ks', name: 'Tuniak konzerva', unit: 'ks', priceEur: 1.99, store: 'priemer' },
  { id: 'treska_kg', name: 'Treska filety', unit: 'kg', priceEur: 7.99, store: 'priemer' },
];

(async () => {
  const batch = db.batch();
  let added = 0;
  let skipped = 0;

  for (const item of STAPLES) {
    const ref = db.collection('prices').doc(item.id);
    const existing = await ref.get();

    if (existing.exists) {
      console.log(`  ${item.id} - už je, preskakujem`);
      skipped++;
      continue;
    }

    batch.set(ref, {
      name: item.name,
      nameNormalized: item.id.replace(/_(kg|g|l|ml|ks)$/, ''),
      unit: item.unit,
      priceEur: item.priceEur,
      source: 'manual-seed',
      offers: [{
        store: item.store,
        priceEur: item.priceEur,
        source: 'manual-seed',
        updatedAt: now,
      }],
      updatedAt: now,
    });
    console.log(`  + ${item.name} (${item.priceEur} €/${item.unit})`);
    added++;
  }

  if (added > 0) {
    await batch.commit();
  }

  console.log(`\nHotovo: pridané ${added}, preskočené ${skipped}\n`);
})();
