// Hook: in-app upozornenia na prijaté a odoslané pozvánky do domácnosti.
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  subscribeInvitesForInviter,
  subscribePendingInvitesForEmailSnapshot,
} from '../services/firestore/households';

const INVITER_STATUS_CACHE_PREFIX = 'mealbuddy_inviterInviteStatus:';

async function loadInviterInviteStatusCache(uid) {
  try {
    const raw = await AsyncStorage.getItem(INVITER_STATUS_CACHE_PREFIX + uid);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function persistInviterInviteStatusCache(uid, statusById) {
  try {
    await AsyncStorage.setItem(INVITER_STATUS_CACHE_PREFIX + uid, JSON.stringify(statusById));
  } catch (e) {
    if (__DEV__ && console?.warn) console.warn('[invites] persist inviter cache failed:', e);
  }
}

function formatPendingInvitesMessage(count) {
  if (count === 1) return 'Máte 1 čakajúcu pozvánku do domácnosti.';
  if (count >= 2 && count <= 4) return `Máte ${count} čakajúce pozvánky do domácnosti.`;
  return `Máte ${count} čakajúcich pozvánok do domácnosti.`;
}

function formatInviterOfflineSummary(acceptCount, declineCount) {
  const parts = [];
  if (acceptCount > 0) {
    if (acceptCount === 1) parts.push('1 pozvánka bola medzičasom prijatá.');
    else if (acceptCount >= 2 && acceptCount <= 4) parts.push(`${acceptCount} pozvánky boli medzičasom prijaté.`);
    else parts.push(`${acceptCount} pozvánok bolo medzičasom prijatých.`);
  }
  if (declineCount > 0) {
    if (declineCount === 1) parts.push('1 pozvánka bola medzičasom odmietnutá.');
    else if (declineCount >= 2 && declineCount <= 4) parts.push(`${declineCount} pozvánky boli medzičasom odmietnuté.`);
    else parts.push(`${declineCount} pozvánok bolo medzičasom odmietnutých.`);
  }
  return parts.join('\n');
}


export function useHouseholdInviteNotifications(enabled, uid, emailLower) {
  const inviterPrimedRef = useRef(false);
  const inviterStatusByIdRef = useRef(new Map());

  const inviteePrimedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !uid) {
      inviterPrimedRef.current = false;
      inviterStatusByIdRef.current = new Map();
      inviteePrimedRef.current = false;
      return;
    }

    let cancelled = false;
    // @type {{ current: import('@firebase/firestore').QuerySnapshot | null }}

    const primeQueueSnapRef = { current: null };
    let inviterPriming = false;

    const processPrimeQueue = () => {
      if (inviterPriming) return;
      inviterPriming = true;
      void (async () => {
        try {
          while (primeQueueSnapRef.current) {
            const s = primeQueueSnapRef.current;
            primeQueueSnapRef.current = null;
            if (cancelled) break;

            const stored = await loadInviterInviteStatusCache(uid);
            if (cancelled) break;

            const current = new Map();
            s.docs.forEach((d) => {
              current.set(d.id, (d.data()?.status ?? '').trim() || '');
            });

            let acceptCount = 0;
            let declineCount = 0;
            for (const [id, cur] of current) {
              const prev = stored[id];
              if (prev === 'pending' && cur === 'accepted') acceptCount += 1;
              else if (prev === 'pending' && cur === 'declined') declineCount += 1;
            }

            if (acceptCount > 0 || declineCount > 0) {
              Alert.alert('Pozvánky', formatInviterOfflineSummary(acceptCount, declineCount));
            }

            const nextStored = {};
            current.forEach((st, id) => {
              nextStored[id] = st;
            });
            await persistInviterInviteStatusCache(uid, nextStored);
            if (cancelled) break;

            inviterStatusByIdRef.current = current;
          }
        } finally {
          inviterPriming = false;
          if (!cancelled) inviterPrimedRef.current = true;
        }
      })();
    };

    const unsubInviter = subscribeInvitesForInviter(uid, (snap) => {
      if (cancelled) return;

      if (!inviterPrimedRef.current) {
        primeQueueSnapRef.current = snap;
        if (inviterPriming) return;
        processPrimeQueue();
        return;
      }

      const seenIds = new Set();
      snap.docs.forEach((d) => {
        const id = d.id;
        seenIds.add(id);
        const nextStatus = (d.data()?.status ?? '').trim() || '';
        const prev = inviterStatusByIdRef.current.get(id);
        inviterStatusByIdRef.current.set(id, nextStatus);
        if (prev === 'pending' && nextStatus === 'accepted') {
          Alert.alert('Pozvánka', 'Niekto prijal vašu pozvánku do domácnosti.');
        } else if (prev === 'pending' && nextStatus === 'declined') {
          Alert.alert('Pozvánka', 'Niekto odmietol vašu pozvánku do domácnosti.');
        }
      });
      for (const id of [...inviterStatusByIdRef.current.keys()]) {
        if (!seenIds.has(id)) inviterStatusByIdRef.current.delete(id);
      }

      void persistInviterInviteStatusCache(uid, Object.fromEntries(inviterStatusByIdRef.current));
    });

    return () => {
      cancelled = true;
      unsubInviter();
      inviterPrimedRef.current = false;
      inviterStatusByIdRef.current = new Map();
      primeQueueSnapRef.current = null;
      inviterPriming = false;
    };
  }, [enabled, uid]);

  useEffect(() => {
    if (!enabled || !uid || !emailLower) {
      inviteePrimedRef.current = false;
      return;
    }

    const unsubInvitee = subscribePendingInvitesForEmailSnapshot(emailLower, (snap) => {
      if (!inviteePrimedRef.current) {
        const n = snap.size;
        if (n > 0) {
          Alert.alert('Pozvánky', formatPendingInvitesMessage(n));
        }
        inviteePrimedRef.current = true;
        return;
      }

      snap.docChanges().forEach((chg) => {
        if (chg.type === 'added') {
          Alert.alert('Pozvánka', 'Prišla vám nová pozvánka do domácnosti.');
        }
      });
    });

    return () => {
      unsubInvitee();
      inviteePrimedRef.current = false;
    };
  }, [enabled, uid, emailLower]);
}

export default useHouseholdInviteNotifications;
