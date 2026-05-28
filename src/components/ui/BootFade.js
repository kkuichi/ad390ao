import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

// Jemný fade-in pri prvom zobrazení obsahu (napr. po boot / načítaní profilu).
// Native driver – plynulé bez extra závislostí.

export default function BootFade({ children, duration = 280 }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    const t = Animated.timing(opacity, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    t.start();
    return () => t.stop();
  }, [duration, opacity]);

  return <Animated.View style={[styles.fill, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
