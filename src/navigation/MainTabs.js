// Spodné záložky: Domov, Recepty, Plán, Nákup, Špajza, Profil.
import React, { useMemo } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StackActions } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme, typography, spacing } from '../theme';
import { hapticSelection } from '../utils/haptics';

import HomeScreen from '../screens/HomeScreen';
import RecipesStack from './RecipesStack';
import PlanScreen from '../screens/PlanScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import PantryScreen from '../screens/PantryScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: 'home',
  Recipes: 'restaurant-outline',
  Plan: 'calendar-outline',
  List: 'cart-outline',
  Pantry: 'cube-outline',
  Profile: 'person-outline',
};

function TabIcon({ name, focused, color, focusColor }) {
  const iconName = TAB_ICONS[name] || 'ellipse';
  const scale = React.useRef(new Animated.Value(focused ? 1.08 : 1)).current;

  React.useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.08 : 1,
      friction: 6,
      tension: 130,
      useNativeDriver: true,
    }).start();
  }, [focused, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={iconName} size={24} color={focused ? focusColor : color} />
    </Animated.View>
  );
}

const TAB_LABELS = {
  Home: 'Domov',
  Recipes: 'Recepty',
  Plan: 'Plán',
  List: 'Nákup',
  Pantry: 'Špajza',
  Profile: 'Profil',
};

export default function MainTabs() {
  const { colors } = useAppTheme();

  const tabBarStyle = useMemo(
    () => ({
      backgroundColor: colors.backgroundPrimary,
      borderTopColor: colors.border,
    }),
    [colors]
  );

  const commonTabOptions = {
    listeners: {
      tabPress: () => {
        hapticSelection();
      },
    },
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        headerStyle: { backgroundColor: colors.backgroundPrimary },
        headerTitleStyle: {
          color: colors.textPrimary,
          ...typography.h4,
          fontFamily: typography.fontFamily,
        },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        freezeOnBlur: true,
        tabBarIcon: ({ focused }) => (
          <TabIcon name={route.name} focused={focused} color={colors.textMuted} focusColor={colors.primary} />
        ),
        tabBarLabel: TAB_LABELS[route.name] || route.name,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle,
        tabBarLabelStyle: styles.tabBarLabel,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Domov' }} {...commonTabOptions} />
      <Tab.Screen
        name="Recipes"
        component={RecipesStack}
        options={{ title: 'Recepty', headerShown: false }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            hapticSelection();
            const recipesRoute = navigation.getState().routes.find((r) => r.name === 'Recipes');
            const nestedKey = recipesRoute?.state?.key;
            const nestedIndex = recipesRoute?.state?.index ?? 0;
            if (nestedKey != null && nestedIndex > 0) {
              e.preventDefault();
              navigation.dispatch({
                ...StackActions.popToTop(),
                target: nestedKey,
              });
            }
          },
        })}
      />
      <Tab.Screen name="Plan" component={PlanScreen} options={{ title: 'Plán' }} {...commonTabOptions} />
      <Tab.Screen name="List" component={ShoppingListScreen} options={{ title: 'Nákup' }} {...commonTabOptions} />
      <Tab.Screen name="Pantry" component={PantryScreen} options={{ title: 'Špajza' }} {...commonTabOptions} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profil' }} {...commonTabOptions} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 12,
  },
});
