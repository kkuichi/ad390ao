// Stack nad tabmi: profil, rozpočet, domácnosť, vlastné ceny.
import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppTheme, typography } from '../theme';
import MainTabs from './MainTabs';
import ProfileScreen from '../screens/ProfileScreen';
import BudgetScreen from '../screens/BudgetScreen';
import HouseholdScreen from '../screens/HouseholdScreen';
import FoodPricesScreen from '../screens/FoodPricesScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  const { colors } = useAppTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.backgroundPrimary },
        headerTitleStyle: {
          color: colors.textPrimary,
          ...typography.h4,
          fontFamily: typography.fontFamily,
        },
        headerShadowVisible: false,
        headerBackTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        gestureEnabled: true,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.backgroundSecondary },
        ...(Platform.OS === 'ios' ? { fullScreenGestureEnabled: true } : {}),
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Môj profil' }} />
      <Stack.Screen name="Budget" component={BudgetScreen} options={{ title: 'Rozpočet' }} />
      <Stack.Screen name="Household" component={HouseholdScreen} options={{ title: 'Domácnosť' }} />
      <Stack.Screen name="FoodPrices" component={FoodPricesScreen} options={{ title: 'Ceny potravín' }} />
    </Stack.Navigator>
  );
}
