// Kontext pre svetlý a tmavý vzhľad aplikácie s perzistovaným výberom režimu.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { colors as lightColors } from './colors';
import { colorsDark } from './colorsDark';

const STORAGE_KEY = '@mealbuddy/theme_preference';

// @typedef {'light' | 'dark' | 'system'} ThemePreference


const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  // @type {[ThemePreference, React.Dispatch<React.SetStateAction<ThemePreference>>]}

  const [preference, setPreferenceState] = useState('system');
  const [storageLoaded, setStorageLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive) return;
        if (raw === 'light' || raw === 'dark' || raw === 'system') {
          setPreferenceState(raw);
        }
        setStorageLoaded(true);
      })
      .catch(() => {
        if (alive) setStorageLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const resolved = useMemo(() => {
    if (preference === 'system') {
      return systemScheme === 'dark' ? 'dark' : 'light';
    }
    return preference;
  }, [preference, systemScheme]);

  const colors = resolved === 'dark' ? colorsDark : lightColors;
  const isDark = resolved === 'dark';

  const value = useMemo(
    () => ({
      preference,
      setPreference,
      isDark,
      colors,
      storageLoaded,
    }),
    [preference, setPreference, isDark, colors, storageLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Aktuálna paleta + nastavenie vzhľadu (svetlý / tmavý / systém).
// Mimo ThemeProvider vráti svetlú paletu (bezpečný fallback).

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      preference: 'system',
      setPreference: () => {},
      isDark: false,
      colors: lightColors,
      storageLoaded: true,
    };
  }
  return ctx;
}
