// Navigačný stack pre neprihláseného používateľa (obrazovka prihlásenia).
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthScreen from '../screens/AuthScreen';

const Stack = createNativeStackNavigator();

export default function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        freezeOnBlur: false,
      }}
    >
      <Stack.Screen name="Auth" component={AuthScreen} />
    </Stack.Navigator>
  );
}
