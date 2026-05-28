// Profil používateľa so zdieľaným cache medzi obrazovkami.
import { useEffect, useState, useCallback, useRef } from 'react';
import { getProfile, setProfile as saveProfile } from '../services/firestore/profiles';

export function useProfile(uid) {
  const cached = uid ? _store.get(uid) : null;
  const [profile, setProfile] = useState(cached || null);
  const [loading, setLoading] = useState(cached == null);
  const lastUidRef = useRef(uid);

  const fetchProfile = useCallback(async (fromServer = false) => {
    if (!uid) return null;
    try {
      return await getProfile(uid, { fromServer });
    } catch {
      // fallback na lokálnu cache (offline / timeout), aby appka ostala použiteľná
      return getProfile(uid);
    }
  }, [uid]);

  const refetch = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!uid) {
      _store.delete(uid);
      _emit(uid, null);
      setProfile(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const p = await fetchProfile(true);
      _store.set(uid, p || null);
      _emit(uid, p || null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [uid, fetchProfile]);

  // @param {Partial<import('../services/firestore/profiles').ProfileData>} partial
// @param {{ mergeFrom?: import('../services/firestore/profiles').ProfileData | null }} [opts]

  const updateProfile = useCallback(
    async (partial, opts = {}) => {
      if (!uid) return;
      const base =
        opts.mergeFrom != null
          ? opts.mergeFrom
          : _store.get(uid) || (await getProfile(uid)) || {};
      const merged = { ...base, ...partial };
      _store.set(uid, merged);
      _emit(uid, merged);
      try {
        await saveProfile(uid, merged);
      } catch (e) {
        await refetch();
        throw e;
      }
    },
    [uid, refetch]
  );

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return undefined;
    }
    const unsub = _subscribe(uid, (next) => {
      setProfile(next);
      setLoading(false);
    });
    if (lastUidRef.current !== uid || !_store.has(uid)) {
      lastUidRef.current = uid;
      setLoading(true);
      fetchProfile(true).then((p) => {
        _store.set(uid, p || null);
        _emit(uid, p || null);
      });
      return unsub;
    }
    setProfile(_store.get(uid) || null);
    setLoading(false);

    // SWR revalidácia na pozadí bez blokovania UI.
    fetchProfile(false).then((p) => {
      _store.set(uid, p || null);
      _emit(uid, p || null);
    });
    return unsub;
  }, [uid, fetchProfile]);

  return { profile, loading, refetch, updateProfile };
}

const _store = new Map();
const _subs = new Map();

function _subscribe(uid, fn) {
  if (!uid) return () => {};
  if (!_subs.has(uid)) _subs.set(uid, new Set());
  const set = _subs.get(uid);
  set.add(fn);
  return () => set.delete(fn);
}

function _emit(uid, value) {
  const set = _subs.get(uid);
  if (!set) return;
  for (const fn of set) {
    try { fn(value); } catch {
      // subscriber chyby nesmú zhodiť ostatných
    }
  }
}

export default useProfile;
