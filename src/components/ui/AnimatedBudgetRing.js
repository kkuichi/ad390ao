// Animovaný kruhový indikátor čerpania rozpočtu.
import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, Easing, View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useAppTheme, typography } from '../../theme';
import {
  getBudgetUsageRatio,
  getBudgetRingColorFromUsage,
  getBudgetTrackColorFromUsage,
} from '../../utils/budgetColors';


const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function AnimatedBudgetRing({
  spent,
  budget,
  size = 160,
  strokeWidth = 12,
}) {
  const { colors } = useAppTheme();
  const safeBudget = Math.max(0, Number(budget) || 0);
  const spentRaw = Math.max(0, Number(spent) || 0);
  const remaining = Math.max(0, safeBudget - spentRaw);
  const percentRemaining = safeBudget > 0 ? Math.max(0, (safeBudget - spentRaw) / safeBudget) : 0;
  const usageRatio = getBudgetUsageRatio(spentRaw, safeBudget);

  const ringColor =
    safeBudget > 0 ? getBudgetRingColorFromUsage(usageRatio, colors) : colors.textMuted;
  const trackColor =
    safeBudget > 0
      ? getBudgetTrackColorFromUsage(Math.min(1, usageRatio), colors)
      : colors.backgroundSecondary;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: percentRemaining,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [percentRemaining, progressAnim]);

  const strokeDashoffset = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const textStyles = useMemo(
    () =>
      StyleSheet.create({
        label: {
          ...typography.caption,
          color: colors.textMuted,
          marginTop: 2,
        },
      }),
    [colors]
  );

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.value, { color: ringColor }]}>
          {remaining.toFixed(remaining >= 100 ? 0 : 2)}€
        </Text>
        <Text style={textStyles.label}>zostáva</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...typography.h1,
    fontWeight: '700',
  },
});
