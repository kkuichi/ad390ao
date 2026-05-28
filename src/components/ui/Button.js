// Štandardizovaný tlačidlový komponent s haptickou odozvou a variantmi.
import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, Animated } from 'react-native';
import { useAppTheme, typography, radius, spacing } from '../../theme';
import { hapticPress } from '../../utils/haptics';

// Tlačidlo podľa Figmy – primary (ružová), secondary (tyrkys), outline.

export default function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
}) {
  const { colors, isDark } = useAppTheme();
  const pressScale = React.useRef(new Animated.Value(1)).current;
  const isOutline = variant === 'outline';
  const isSecondary = variant === 'secondary';

  const bgColor = isOutline
    ? isDark
      ? colors.surfaceMuted
      : 'transparent'
    : isSecondary
      ? colors.secondary
      : colors.primary;
  const borderWidth = isOutline ? 1.5 : 0;
  const borderColor = isOutline ? colors.primary : 'transparent';
  const textColor = isOutline || variant === 'primary' ? (isOutline ? colors.primary : '#FFFFFF') : '#FFFFFF';

  const handlePressIn = () => {
    Animated.timing(pressScale, {
      toValue: 0.98,
      duration: 90,
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      friction: 7,
      tension: 140,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = async () => {
    await hapticPress();
    onPress?.();
  };

  return (
    <Animated.View style={{ transform: [{ scale: pressScale }] }}>
      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: bgColor, borderWidth, borderColor },
          disabled && styles.disabled,
          style,
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          <Text style={[styles.text, { color: textColor }, textStyle]}>{title}</Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.medium,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.7,
  },
  text: {
    ...typography.body,
    fontWeight: '600',
  },
});
