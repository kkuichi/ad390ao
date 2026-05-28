// Firebase klient (Auth, Firestore, Storage). Konfigurácia projektu mealbuddy-ba30f.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyB42MU8TElceZ5ztoDvkO0CXJyWOqK2y28',
  authDomain: 'mealbuddy-ba30f.firebaseapp.com',
  projectId: 'mealbuddy-ba30f',
  storageBucket: 'mealbuddy-ba30f.firebasestorage.app',
  messagingSenderId: '52702908756',
  appId: '1:52702908756:web:1e20c8feee1027a4c278c1',
  measurementId: 'G-6DQBFHX7L8'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
export default app;
