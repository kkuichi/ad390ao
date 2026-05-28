// Prvé spustenie: diéta, rozpočet, domácnosť, vybavenie.
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
  SafeAreaView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { auth } from '../firebase';
import { setProfile as saveProfileToFirestore } from '../services/firestore/profiles';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import { DIETARY_PREF_OPTIONS, EQUIPMENT_OPTIONS } from '../constants/profilePrefs';


const STEPS = [
  {
    key: 'dietaryPrefs',
    icon: 'leaf-outline',
    title: 'Diétne preferencie',
    subtitle: 'Vyber, čo by sme mali brať do úvahy pri odporúčaniach. Môžeš zvoliť aj viac.',
    options: DIETARY_PREF_OPTIONS,
  },
  {
    key: 'weeklyBudget',
    icon: 'wallet-outline',
    title: 'Týždenný rozpočet',
    subtitle: 'Koľko si chceš dať týždenne na nákupy? Môžeš ho neskôr kedykoľvek zmeniť.',
    min: 10,
    max: 200,
    step: 10,
    unit: '€',
  },
  {
    key: 'householdSize',
    icon: 'people-outline',
    title: 'Veľkosť domácnosti',
    subtitle: 'Pre koľko ľudí varíš?',
    min: 1,
    max: 6,
    step: 1,
    unit: 'ľudí',
  },
  {
    key: 'equipment',
    icon: 'restaurant-outline',
    title: 'Vybavenie kuchyne',
    subtitle: 'Čo máš doma?',
    options: EQUIPMENT_OPTIONS,
  },
];

export default function OnboardingScreen({ route }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createOnboardingStyles(colors), [colors]);
  const onComplete = route?.params?.onComplete;
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    dietaryPrefs: [],
    weeklyBudget: 50,
    householdSize: 1,
    equipment: [],
  });
  const [saving, setSaving] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;
  const progress = (step + 1) / STEPS.length;

  // Animácia šírky progress baru – plynulý prechod medzi krokmi.
  const progressAnim = useRef(new Animated.Value(progress)).current;
  // Animácia obsahu pri zmene kroku – jemný fade + slide. Bez toho pôsobí
  // tlačidlo Ďalej "lacno" – obsah sa len skokovo prepne.
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    Animated.sequence([
      Animated.timing(contentAnim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
      Animated.timing(contentAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [progress, contentAnim, progressAnim, step]);

  const toggleOption = (key, value) => {
    const arr = profile[key] || [];
    const next = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
    setProfile((p) => ({ ...p, [key]: next }));
  };

  const handleNext = async () => {
    if (isLast) {
      setSaving(true);
      try {
        const uid = auth.currentUser?.uid;
        if (uid) {
          const nowIso = new Date().toISOString();
          await saveProfileToFirestore(uid, {
            displayName:
              auth.currentUser?.displayName
              || auth.currentUser?.email?.split('@')[0]
              || undefined,
            dietaryPrefs: profile.dietaryPrefs,
            weeklyBudget: profile.weeklyBudget,
            householdSize: profile.householdSize,
            equipment: profile.equipment,
            createdAt: nowIso,
            budgetCycleAnchorAt: nowIso,
          });
          onComplete?.();
        }
      } finally {
        setSaving(false);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const numericValue = profile[current.key];
  const canDecrease = current.min != null && numericValue > current.min;
  const canIncrease = current.max != null && numericValue < current.max;

  // Animovaný transform: jemné posunutie zľava + opacity.
  const contentTranslate = contentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <View style={styles.topBarRow}>
          <Text style={styles.stepLabel}>
            Krok {step + 1} <Text style={styles.stepLabelMuted}>/ {STEPS.length}</Text>
          </Text>
          {!isFirst && (
            <TouchableOpacity onPress={handleBack} hitSlop={8} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
              <Text style={styles.backBtnText}>Späť</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={{
            opacity: contentAnim,
            transform: [{ translateX: contentTranslate }],
          }}
        >
          {/* krok onboardingu */}
          <View style={styles.hero}>
            <View style={styles.heroIconCircle}>
              <Ionicons name={current.icon} size={32} color={colors.primary} />
            </View>
            <Text style={styles.heroTitle}>{current.title}</Text>
            <Text style={styles.heroSubtitle}>{current.subtitle}</Text>
          </View>

          {current.options ? (
            <View style={styles.chips}>
              {current.options.map((opt) => {
                const selected = (profile[current.key] || []).includes(opt);
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleOption(current.key, opt)}
                    activeOpacity={0.85}
                  >
                    {selected && (
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                    )}
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.stepperCard}>
              <Text style={styles.stepperValue}>
                {numericValue}
                <Text style={styles.stepperUnit}> {current.unit}</Text>
              </Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={[styles.stepperBtn, !canDecrease && styles.stepperBtnDisabled]}
                  onPress={() =>
                    setProfile((p) => ({
                      ...p,
                      [current.key]: Math.max(current.min, (p[current.key] ?? current.min) - current.step),
                    }))
                  }
                  disabled={!canDecrease}
                  activeOpacity={0.85}
                >
                  <Ionicons name="remove" size={28} color={canDecrease ? '#FFFFFF' : '#94A3B8'} />
                </TouchableOpacity>
                <View style={styles.stepperHint}>
                  <Text style={styles.stepperHintText}>
                    {current.min} – {current.max} {current.unit}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.stepperBtn, !canIncrease && styles.stepperBtnDisabled]}
                  onPress={() =>
                    setProfile((p) => ({
                      ...p,
                      [current.key]: Math.min(current.max, (p[current.key] ?? current.min) + current.step),
                    }))
                  }
                  disabled={!canIncrease}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={28} color={canIncrease ? '#FFFFFF' : '#94A3B8'} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.nextBtn, saving && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Text style={styles.nextBtnText}>{isLast ? 'Dokončiť' : 'Pokračovať'}</Text>
              <Ionicons
                name={isLast ? 'checkmark' : 'arrow-forward'}
                size={20}
                color="#FFFFFF"
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function createOnboardingStyles(colors) {
  return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.backgroundPrimary,
  },

  topBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  topBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  stepLabel: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stepLabelMuted: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  backBtnText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },

  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  heroIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: {
    ...typography.title,
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    ...typography.body,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 24,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },

  stepperCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.large,
    padding: spacing.xl,
    alignItems: 'center',
    marginHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperValue: {
    fontSize: 56,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  stepperUnit: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.textMuted,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: spacing.md,
  },
  stepperBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.small,
  },
  stepperBtnDisabled: {
    backgroundColor: colors.border,
  },
  stepperHint: {
    flex: 1,
    alignItems: 'center',
  },
  stepperHintText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.backgroundPrimary,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.medium,
    ...shadows.small,
  },
  nextBtnDisabled: { opacity: 0.7 },
  nextBtnText: {
    ...typography.body,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
}
