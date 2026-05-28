import { doc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../utils/firestoreSanitize';

// Profil používateľa: profiles/{uid} (rozpočet, diéta, vybavenie, obľúbená predajňa).
const COLLECTION = 'profiles';

export async function getProfile(uid, opts = {}) {
  if (!uid) return null;
  const ref = doc(db, COLLECTION, uid);
  const snap = opts.fromServer ? await getDocFromServer(ref) : await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function setProfile(uid, profile) {
  if (!uid) return;
  const ref = doc(db, COLLECTION, uid);
  const nowIso = new Date().toISOString();
  const data = sanitizeForFirestore({
    displayName: profile?.displayName ?? undefined,
    dietaryPrefs: profile?.dietaryPrefs ?? [],
    weeklyBudget: profile?.weeklyBudget ?? null,
    householdSize: profile?.householdSize ?? null,
    equipment: profile?.equipment ?? [],
    preferredStore: profile?.preferredStore ?? null,
    createdAt: profile?.createdAt ?? nowIso,
    budgetCycleAnchorAt: profile?.budgetCycleAnchorAt ?? profile?.createdAt ?? nowIso,
    favoriteRecipeIds: Array.isArray(profile?.favoriteRecipeIds) ? profile.favoriteRecipeIds : [],
    activeHouseholdId: profile?.activeHouseholdId ?? null,
    updatedAt: nowIso,
  });
  await setDoc(ref, data, { merge: true });
}

export function hasCompletedOnboarding(profile) {
  return profile != null && typeof profile.weeklyBudget === 'number';
}
