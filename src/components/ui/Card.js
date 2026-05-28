// Generický kartový kontajner s tieňom a paddingom.
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme, radius, shadows, spacing } from '../../theme';


export default function Card({
  children,
  variant = 'white',
  paddingSize = 'medium',
  onPress,
  style,
}) {
  const { colors, isDark } = useAppTheme();
  const paddingMap = { small: spacing.md, medium: spacing.lg, large: spacing.xl };
  const bgColor =
    variant === 'white'
      ? colors.backgroundPrimary
      : colors[`card${variant.charAt(0).toUpperCase() + variant.slice(1)}`] || colors.cardPink;

  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bgColor,
          padding: paddingMap[paddingSize],
          borderWidth: 1,
          borderColor: colors.border,
        },
        variant === 'white' && shadows.medium,
        variant !== 'white' && isDark && shadows.small,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.large,
    overflow: 'hidden',
  },
});
