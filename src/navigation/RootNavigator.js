// Auth → onboarding (prvý login) → Main.
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthStack from './AuthStack';
import MainStack from './MainStack';
import OnboardingScreen from '../screens/OnboardingScreen';
import { colors, typography } from '../theme';

const Stack = createNativeStackNavigator();

export default function RootNavigator({ user, hasProfile, loading, onProfileComplete }) {
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { marginTop: 12 }]}>Načítavam…</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        freezeOnBlur: false,
        animation: 'default',
      }}
    >
      {!user ? (
        <Stack.Screen name="AuthStack" component={AuthStack} />
      ) : !hasProfile ? (
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          initialParams={{ onComplete: onProfileComplete }}
        />
      ) : (
        <Stack.Screen name="Main" component={MainStack} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
