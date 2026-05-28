// História nákupov pre rozpočet a tracking.


import { collection, doc, addDoc, getDocs, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../utils/firestoreSanitize';

function ordersRef(uid) {
  return collection(db, 'purchases', uid, 'orders');
}


export async function createPurchaseOrder(uid, orderData) {
  if (!uid) throw new Error('uid required');
  
  const ref = await addDoc(ordersRef(uid), sanitizeForFirestore({
    store: orderData.store || '',
    items: orderData.items || [],
    estTotalEur: orderData.estTotalEur || 0,
    paidTotalEur: orderData.paidTotalEur || null,
    planWeekKey: orderData.planWeekKey || null,
    createdAt: serverTimestamp(),
  }));
  
  return ref.id;
}


export async function getPurchaseHistory(uid, limitCount = 30) {
  if (!uid) return [];
  
  const q = query(
    ordersRef(uid),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}


export async function getPurchaseHistoryBetween(uid, fromInclusive, toExclusive, limitCount = 200) {
  if (!uid) return [];
  const fromMs = fromInclusive instanceof Date ? fromInclusive.getTime() : 0;
  const toMs = toExclusive instanceof Date ? toExclusive.getTime() : Number.MAX_SAFE_INTEGER;
  const list = await getPurchaseHistory(uid, limitCount);
  const toMsField = (v) => {
    if (v == null) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v === 'number') return v;
    return 0;
  };
  return list.filter((entry) => {
    const ms = toMsField(entry.createdAt);
    if (!ms) return false;
    return ms >= fromMs && ms < toMs;
  });
}


export async function getPurchasesForWeek(uid, weekKey) {
  if (!uid || !weekKey) return [];
  
  const q = query(
    ordersRef(uid),
    where('planWeekKey', '==', weekKey),
    orderBy('createdAt', 'desc')
  );
  
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}


export function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7)); // Najbližší štvrtok
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-${String(week).padStart(2, '0')}`;
}

export default {
  createPurchaseOrder,
  getPurchaseHistory,
  getPurchaseHistoryBetween,
  getPurchasesForWeek,
  getWeekKey,
};
