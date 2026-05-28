import { registerRootComponent } from 'expo';
import { enableScreens } from 'react-native-screens';

// Expo bootstrap; native screens vypnuté kvôli kompatibilite na iOS.
enableScreens(false);
import App from './App';
registerRootComponent(App);
