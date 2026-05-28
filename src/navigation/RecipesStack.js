// Navigačný stack modulu Recepty (zoznam, detail, vytvorenie nového receptu).
import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppTheme, typography } from '../theme';
import RecipesScreen from '../screens/RecipesScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import CreateRecipeScreen from '../screens/CreateRecipeScreen';

const Stack = createNativeStackNavigator();

export default function RecipesStack() {
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
        popToTopOnBlur: true,
      }}
    >
      <Stack.Screen
        name="RecipeList"
        component={RecipesScreen}
        options={{
          title: 'Recepty',
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={{ title: 'Recept' }}
      />
      <Stack.Screen
        name="CreateRecipe"
        component={CreateRecipeScreen}
        options={{ title: 'Nový recept' }}
      />
      <Stack.Screen
        name="EditRecipe"
        component={CreateRecipeScreen}
        options={{ title: 'Upraviť recept' }}
      />
    </Stack.Navigator>
  );
}
