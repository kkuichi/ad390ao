// Tiene z Figmy (s ružovým nádychom) – React Native


import { Platform } from 'react-native';

const shadowColor = 'rgb(255, 107, 157)';

export const shadows = {
  small: Platform.select({
    ios: {
      shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
    },
    android: { elevation: 2 },
  }),
  medium: Platform.select({
    ios: {
      shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
    },
    android: { elevation: 4 },
  }),
  large: Platform.select({
    ios: {
      shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 32,
    },
    android: { elevation: 8 },
  }),
  colored: Platform.select({
    ios: {
      shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
    },
    android: { elevation: 6 },
  }),
};

export default shadows;
