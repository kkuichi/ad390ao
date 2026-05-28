// Firestore operácie nad domácnosťami a pozvánkami členov.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../utils/firestoreSanitize';

const HOUSEHOLDS = 'households';
const INVITES = 'householdInvites';
export const HOUSEHOLD_MEMBER_SUMMARY = 'memberSummary';


export async function syncHouseholdMemberSummary(householdId, uid, info) {
  if (!householdId || !uid) return;
  const ref = doc(db, HOUSEHOLDS, householdId, HOUSEHOLD_MEMBER_SUMMARY, uid);
  await setDoc(
    ref,
    sanitizeForFirestore({
      displayName: (info?.displayName || '').trim(),
      emailLower: (info?.emailLower || '').trim().toLowerCase(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );
}

// @param {string} householdId
// @returns {Promise<Record<string, { displayName?: string, emailLower?: string }>>}

export async function fetchHouseholdMemberSummaries(householdId) {
  if (!householdId) return {};
  const snap = await getDocs(collection(db, HOUSEHOLDS, householdId, HOUSEHOLD_MEMBER_SUMMARY));
  const out = {};
  snap.docs.forEach((d) => {
    out[d.id] = d.data() || {};
  });
  return out;
}


export async function createHousehold(ownerUid, name, ownerName) {
  if (!ownerUid) throw new Error('uid required');
  const ref = doc(collection(db, HOUSEHOLDS));
  await setDoc(
    ref,
    sanitizeForFirestore({
      name: (name || 'Moja domácnosť').trim(),
      ownerUid,
      memberUids: [ownerUid],
      memberNames: ownerName ? { [ownerUid]: ownerName.trim() } : {},
      createdAt: serverTimestamp(),
    })
  );
  return ref.id;
}

export async function getHousehold(householdId) {
  if (!householdId) return null;
  const snap = await getDoc(doc(db, HOUSEHOLDS, householdId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Domácnosti, kde je používateľ členom (vrátane vlastníctva).

export async function listHouseholdsForUser(uid) {
  if (!uid) return [];
  const byId = new Map();

  // Primárne: členstvo v memberUids.
  try {
    const qMember = query(collection(db, HOUSEHOLDS), where('memberUids', 'array-contains', uid));
    const memberSnap = await getDocs(qMember);
    memberSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  } catch (e) {
    if (__DEV__ && console?.warn) console.warn('[households] member query failed:', e);
  }

  // Fallback: domácnosti, kde je používateľ owner.
  try {
    const qOwner = query(collection(db, HOUSEHOLDS), where('ownerUid', '==', uid));
    const ownerSnap = await getDocs(qOwner);
    ownerSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  } catch (e) {
    if (__DEV__ && console?.warn) console.warn('[households] owner query failed:', e);
  }

  return [...byId.values()];
}

// Pozvánka podľa e-mailu (pozvaný musí mať v účte rovnaký e-mail).

export async function createHouseholdInvite(householdId, inviterUid, emailRaw) {
  const emailLower = (emailRaw || '').trim().toLowerCase();
  if (!householdId || !inviterUid || !emailLower) throw new Error('Neplatné údaje');
  const ref = await addDoc(
    collection(db, INVITES),
    sanitizeForFirestore({
      householdId,
      inviterUid,
      emailLower,
      status: 'pending',
      createdAt: serverTimestamp(),
    })
  );
  return ref.id;
}

export async function listPendingInvitesForEmail(email) {
  const emailLower = (email || '').trim().toLowerCase();
  if (!emailLower) return [];
  const q = query(collection(db, INVITES), where('emailLower', '==', emailLower), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Prijatie pozvánky (overenie e-mailu na strane volajúceho).

export async function acceptHouseholdInvite(inviteId, acceptorUid, acceptorEmail, acceptorName) {
  const inviteRef = doc(db, INVITES, inviteId);
  const snap = await getDoc(inviteRef);
  if (!snap.exists()) throw new Error('Pozvánka neexistuje');
  const inv = snap.data();
  if (inv.status !== 'pending') throw new Error('Pozvánka už nie je aktívna');
  const em = (acceptorEmail || '').trim().toLowerCase();
  if (em !== inv.emailLower) throw new Error('Táto pozvánka je pre iný e-mail');
  const hid = inv.householdId;
  const hRef = doc(db, HOUSEHOLDS, hid);
  const name = (acceptorName || '').trim();
  const batch = writeBatch(db);
  batch.update(hRef, { memberUids: arrayUnion(acceptorUid) });
  batch.update(inviteRef, {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
    acceptedByUid: acceptorUid,
  });
  await batch.commit();
  if (name) {
    await updateDoc(hRef, { [`memberNames.${acceptorUid}`]: name });
  }
}

export async function declineHouseholdInvite(inviteId) {
  await updateDoc(doc(db, INVITES, inviteId), {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}


export async function deleteHousehold(householdId) {
  if (!householdId) throw new Error('householdId required');
  const hRef = doc(db, HOUSEHOLDS, householdId);
  const hSnap = await getDoc(hRef);
  if (!hSnap.exists()) return;

  const batch = writeBatch(db);

  // zdieľané shopping listy pod households/{id}/lists
  const listsSnap = await getDocs(collection(db, HOUSEHOLDS, householdId, 'lists'));
  listsSnap.docs.forEach((d) => batch.delete(d.ref));

  const summarySnap = await getDocs(
    collection(db, HOUSEHOLDS, householdId, HOUSEHOLD_MEMBER_SUMMARY)
  );
  summarySnap.docs.forEach((d) => batch.delete(d.ref));

  const pantrySnap = await getDocs(collection(db, HOUSEHOLDS, householdId, 'pantryItems'));
  pantrySnap.docs.forEach((d) => batch.delete(d.ref));

  batch.delete(hRef);
  await batch.commit();
}


export function subscribeInvitesForInviter(inviterUid, onNext, onError) {
  if (!inviterUid) return () => {};
  const q = query(collection(db, INVITES), where('inviterUid', '==', inviterUid));
  return onSnapshot(
    q,
    onNext,
    onError ||
      ((e) => {
        if (__DEV__ && console?.warn) console.warn('[households] subscribeInvitesForInviter:', e);
      })
  );
}


export function subscribePendingInvitesForEmailSnapshot(email, onNext, onError) {
  const emailLower = (email || '').trim().toLowerCase();
  if (!emailLower) return () => {};
  const q = query(collection(db, INVITES), where('emailLower', '==', emailLower), where('status', '==', 'pending'));
  return onSnapshot(
    q,
    onNext,
    onError ||
      ((e) => {
        if (__DEV__ && console?.warn) console.warn('[households] subscribePendingInvitesForEmailSnapshot:', e);
      })
  );
}
