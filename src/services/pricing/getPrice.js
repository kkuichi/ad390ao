// Wrapper okolo prices.js pre modul recipeCost / calcList.
import { getBestOfferFor, convertQtyToOfferUnit } from '../prices';
import { getCanonicalName } from '../normalize';
import { normalizeUnit } from './normalize';

function toBaseQty(qty, unitRaw) {
  const raw = String(unitRaw || 'ks').trim().toLowerCase();
  let baseUnit = normalizeUnit(raw) || 'ks';
  let qtyBase = Number(qty ?? 1);
  if (!Number.isFinite(qtyBase) || qtyBase <= 0) qtyBase = 1;

  if (raw === 'kg') {
    qtyBase *= 1000;
    baseUnit = 'g';
  } else if (raw === 'l') {
    qtyBase *= 1000;
    baseUnit = 'ml';
  } else if (raw === 'dcl') {
    qtyBase *= 100;
    baseUnit = 'ml';
  } else if (raw === 'polievkova lyzica' || raw === 'polievková lyžica' || raw === 'pl' || raw === 'pl.') {
    qtyBase *= 15;
    baseUnit = 'ml';
  } else if (/^[čc]ajov[áa]\s*ly[žz]ic[aeu]$|^[čc]l\.?$/.test(raw)) {
    qtyBase *= 5;
    baseUnit = 'ml';
  } else if (raw === 'hrncek' || raw === 'hrnček' || raw === 'hrnok' || raw === 'salka' || raw === 'šálka') {
    qtyBase *= 250;
    baseUnit = 'ml';
  } else if (raw === 'stipka' || raw === 'štipka') {
    // štipka je orientačne 1 g
    qtyBase *= 1;
    baseUnit = 'g';
  }

  return { qtyBase, baseUnit };
}


export async function findBestOffer(nameNorm, prefer, uid) {
  if (!nameNorm || typeof nameNorm !== 'string') return null;

  const offer = await getBestOfferFor(nameNorm, prefer, { uid: uid || undefined });
  if (!offer) return null;

  return {
    store: offer.store || '',
    unitBase: offer.unit,
    pricePerBase: offer.baseQty > 0 ? offer.priceEur / offer.baseQty : 0,
    offer,
  };
}


export async function estimateIngredientCost(ing, prefer, uid) {
  if (!ing || !ing.name) return null;

  const { qtyBase, baseUnit } = toBaseQty(ing.qty, ing.unit);
  const bestOffer = await findBestOffer(ing.name, prefer, uid);
  if (!bestOffer || !bestOffer.offer) return null;

  const canonical = getCanonicalName(ing.name);
  const qtyInOfferUnit = convertQtyToOfferUnit(
    qtyBase,
    baseUnit,
    bestOffer.unitBase,
    canonical
  );
  const estEur = bestOffer.offer.baseQty > 0
    ? (qtyInOfferUnit / bestOffer.offer.baseQty) * bestOffer.offer.priceEur
    : 0;

  return {
    estEur: Math.round(estEur * 100) / 100,
    source: bestOffer.offer.source || 'firestore',
    store: bestOffer.store,
  };
}

export default { findBestOffer, estimateIngredientCost };
