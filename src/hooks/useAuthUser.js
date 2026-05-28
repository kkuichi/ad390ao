import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

// Hook pre aktuálneho Firebase používateľa.
// @returns {{ user: import('firebase/auth').User | null, loading: boolean }}

export function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ?? null);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading };
}

export default useAuthUser;
