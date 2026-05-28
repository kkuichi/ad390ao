// Tlačidlo pre prihlásenie cez Google OAuth (Expo Auth Session).
import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../../firebase';
import { setProfile as saveProfileToFirestore } from '../../services/firestore/profiles';
import Button from '../ui/Button';

WebBrowser.maybeCompleteAuthSession();

function getGoogleOAuthClientIds() {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const expoClientId =
    process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID || webClientId;
  const iosClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || webClientId;
  const androidClientId =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || webClientId;

  return { webClientId, expoClientId, iosClientId, androidClientId };
}

export function isGoogleOAuthConfigured() {
  const { webClientId, iosClientId, androidClientId } = getGoogleOAuthClientIds();
  if (!webClientId) return false;
  if (Platform.OS === 'android') return Boolean(androidClientId);
  if (Platform.OS === 'ios') return Boolean(iosClientId);
  return true;
}

// Google OAuth – len ak sú nastavené client ID (inak pád na Androide).

export default function GoogleSignInButton({ style, disabled }) {
  const { webClientId, expoClientId, iosClientId, androidClientId } =
    getGoogleOAuthClientIds();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleRequest, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    expoClientId,
    webClientId,
    iosClientId,
    androidClientId,
  });

  useEffect(() => {
    const run = async () => {
      if (googleResponse?.type !== 'success') return;
      const idToken = googleResponse.authentication?.idToken;
      if (!idToken) {
        Alert.alert('Google prihlásenie', 'Chýba ID token z Google.');
        return;
      }
      setGoogleLoading(true);
      try {
        const credential = GoogleAuthProvider.credential(idToken);
        const cred = await signInWithCredential(auth, credential);
        const user = cred.user;
        const name =
          (user.displayName || '').trim()
          || (user.email || '').split('@')[0]
          || 'Používateľ';
        await saveProfileToFirestore(user.uid, { displayName: name });
      } catch (e) {
        Alert.alert('Google prihlásenie', e?.message || 'Prihlásenie zlyhalo');
      } finally {
        setGoogleLoading(false);
      }
    };
    run();
  }, [googleResponse]);

  const handleGoogle = async () => {
    if (!googleRequest) {
      Alert.alert('Google prihlásenie', 'Chýba OAuth konfigurácia.');
      return;
    }
    await promptGoogleAsync({
      useProxy: Platform.OS === 'web',
    });
  };

  return (
    <Button
      title={googleLoading ? 'Prihlasujem cez Google…' : 'Pokračovať cez Google'}
      onPress={handleGoogle}
      variant="outline"
      style={style}
      loading={googleLoading}
      disabled={disabled || googleLoading}
    />
  );
}
