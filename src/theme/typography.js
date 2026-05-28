// Typografia z Figma – React Native


import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'sans-serif',
});

export const typography = {
  h1: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: Math.round(28 * 1.2),
  },
  h2: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: Math.round(24 * 1.3),
  },
  h3: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: Math.round(20 * 1.4),
  },
  h4: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: Math.round(18 * 1.4),
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: Math.round(16 * 1.5),
  },
  caption: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: Math.round(14 * 1.4),
  },
  small: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: Math.round(12 * 1.3),
  },
  fontFamily,
};

export default typography;
