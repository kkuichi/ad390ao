// Vstup aplikácie: Firebase auth → onboarding alebo hlavná navigácia (MainStack).
import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { auth } from './src/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getProfile, hasCompletedOnboarding } from './src/services/firestore/profiles';
import { ThemeProvider, useAppTheme, typography } from './src/theme';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import MainStack from './src/navigation/MainStack';
import BootFade from './src/components/ui/BootFade';
import { useHouseholdInviteNotifications } from './src/hooks/useHouseholdInviteNotifications';

const Stack = createNativeStackNavigator();

function NavigationRoot() {
  const { colors, isDark } = useAppTheme();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(undefined);
  const [authLoading, setAuthLoading] = useState(true);
  const [err, setErr] = useState(null);

  const navTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: colors.primary,
        background: colors.backgroundSecondary,
        card: colors.backgroundPrimary,
        text: colors.textPrimary,
        border: colors.border,
        notification: colors.primary,
      },
    }),
    [isDark, colors]
  );

  const loadingStyles = useMemo(
    () =>
      StyleSheet.create({
        centered: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          backgroundColor: colors.backgroundSecondary,
        },
        errorText: {
          marginTop: 8,
          color: colors.error,
        },
        loadingText: {
          ...typography.body,
          color: colors.textMuted,
        },
      }),
    [colors]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setAuthLoading(false);
      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        return;
      }
      setUser(firebaseUser);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      return;
    }
    setProfile(undefined);
    let cancelled = false;
    getProfile(user.uid).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const refetchProfile = useCallback(() => {
    if (!user?.uid) return;
    getProfile(user.uid).then(setProfile);
  }, [user?.uid]);

  const hasProfile = Boolean(user && hasCompletedOnboarding(profile));
  const loading = Boolean(authLoading || (user && profile === undefined));

  useHouseholdInviteNotifications(
    Boolean(hasProfile && user),
    user?.uid ?? null,
    (user?.email || '').trim().toLowerCase()
  );

  if (err) {
    return (
      <View style={loadingStyles.centered}>
        <Text style={{ color: colors.textPrimary }}>Chyba prihlásenia:</Text>
        <Text style={loadingStyles.errorText}>{err}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={loadingStyles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[loadingStyles.loadingText, { marginTop: 12 }]}>Načítavam…</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <BootFade>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              contentStyle: { backgroundColor: colors.backgroundSecondary },
              gestureEnabled: true,
              ...(Platform.OS === 'ios' ? { fullScreenGestureEnabled: true } : {}),
            }}
          >
            {!user ? (
              <Stack.Screen name="Auth" component={AuthScreen} />
            ) : !hasProfile ? (
              <Stack.Screen
                name="Onboarding"
                component={OnboardingScreen}
                initialParams={{ onComplete: refetchProfile }}
              />
            ) : (
              <Stack.Screen name="Main" component={MainStack} />
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </BootFade>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NavigationRoot />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
