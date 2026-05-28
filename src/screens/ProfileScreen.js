// Profil: meno, diéta, vybavenie, predajňa, odkazy na rozpočet a domácnosť.
import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import { useRecipes } from '../hooks/useRecipes';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Card from '../components/ui/Card';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { setProfile as saveProfile } from '../services/firestore/profiles';
import {
  listHouseholdsForUser,
  syncHouseholdMemberSummary,
} from '../services/firestore/households';
import { DIETARY_PREF_OPTIONS, EQUIPMENT_OPTIONS } from '../constants/profilePrefs';

export default function ProfileScreen({ navigation }) {
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile, loading, refetch } = useProfile(uid);
  const { recipes, refetch: refetchRecipes } = useRecipes({ uid });
  const { colors, preference, setPreference } = useAppTheme();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const [preferredStore, setPreferredStore] = useState(profile?.preferredStore ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [dietaryPrefsEdit, setDietaryPrefsEdit] = useState(profile?.dietaryPrefs ?? []);
  const [equipmentEdit, setEquipmentEdit] = useState(profile?.equipment ?? []);
  const [prefsSaving, setPrefsSaving] = useState(false);

  React.useEffect(() => {
    setPreferredStore(profile?.preferredStore ?? '');
    setDisplayName(profile?.displayName ?? '');
    setDietaryPrefsEdit(profile?.dietaryPrefs ?? []);
    setEquipmentEdit(profile?.equipment ?? []);
  }, [
    profile?.preferredStore,
    profile?.displayName,
    profile?.dietaryPrefs,
    profile?.equipment,
  ]);

  const handleSignOut = () => {
    signOut(auth);
  };

  const savePreferredStore = async (value) => {
    if (!uid) return;
    const next = (value || '').trim();
    await saveProfile(uid, { ...profile, preferredStore: next || null });
    refetch();
  };

  const saveDisplayName = async (value) => {
    if (!uid) return;
    const next = (value || '').trim();
    if (!next) return;
    await saveProfile(uid, { ...profile, displayName: next });
    refetch();
    const em = (user?.email || '').trim().toLowerCase();
    try {
      const households = await listHouseholdsForUser(uid);
      await Promise.all(
        households
          .filter((hh) => (hh.memberUids || []).includes(uid))
          .map((hh) =>
            syncHouseholdMemberSummary(hh.id, uid, {
              displayName: next,
              emailLower: em,
            })
          )
      );
    } catch {
      // domácnosť môže byť nedostupná offline; profil je už uložený
    }
  };

  const weeklyBudget = profile?.weeklyBudget;
  const householdSize = profile?.householdSize;

  const toggleProfilePref = async (key, value) => {
    if (!uid || prefsSaving) return;
    const isDiet = key === 'dietaryPrefs';
    const current = isDiet ? dietaryPrefsEdit : equipmentEdit;
    const next = current.includes(value)
      ? current.filter((x) => x !== value)
      : [...current, value];
    if (isDiet) setDietaryPrefsEdit(next);
    else setEquipmentEdit(next);
    setPrefsSaving(true);
    try {
      await saveProfile(uid, {
        ...profile,
        dietaryPrefs: isDiet ? next : dietaryPrefsEdit,
        equipment: isDiet ? equipmentEdit : next,
      });
      await refetch();
    } finally {
      setPrefsSaving(false);
    }
  };

  const avatarText = useMemo(() => {
    const src = (profile?.displayName || user?.email || '').trim();
    if (!src) return '?';
    return src[0].toUpperCase();
  }, [profile?.displayName, user?.email]);

  const myRecipesCount = useMemo(() => {
    if (!uid) return 0;
    return (recipes || []).filter(
      (r) => r.isUserRecipe && r.authorUid === uid,
    ).length;
  }, [recipes, uid]);

  const handlePullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([refetch({ silent: true }), refetchRecipes(true)]);
    } finally {
      setPullRefreshing(false);
    }
  }, [refetch, refetchRecipes]);

  const goRecipesMine = () => {
    
    navigation.navigate('Recipes', {
      screen: 'RecipeList',
      params: { initialScope: 'mine' },
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Načítavam profil…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={pullRefreshing} onRefresh={handlePullRefresh} tintColor={colors.primary} />
      }
    >
      {}
      <View style={[styles.headerCard, shadows.medium]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarText}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEmail} numberOfLines={1}>
            {profile?.displayName || user?.email || 'Host účet'}
          </Text>
          <Text style={styles.headerSubtitle}>{user?.email || 'Bez e-mailu'}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, shadows.small]}>
          <Text style={styles.statLabel}>Týždenný rozpočet</Text>
          <Text style={styles.statValue}>
            {weeklyBudget != null ? `${weeklyBudget} €` : '—'}
          </Text>
        </View>
        <View style={[styles.statCard, shadows.small]}>
          <Text style={styles.statLabel}>Domácnosť</Text>
          <Text style={styles.statValue}>
            {householdSize != null
              ? `${householdSize} ${householdSize === 1 ? 'člen' : 'členovia'}`
              : '—'}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Vzhľad</Text>
      <View style={styles.appearanceRow}>
        {[
          { id: 'system', label: 'Systém' },
          { id: 'light', label: 'Svetlý' },
          { id: 'dark', label: 'Tmavý' },
        ].map((opt) => {
          const active = preference === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.appearanceChip, active && styles.appearanceChipActive]}
              onPress={() => setPreference(opt.id)}
              activeOpacity={0.85}
            >
              <Text style={[styles.appearanceChipText, active && styles.appearanceChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Skratky</Text>

      <ActionCard
        icon="pricetag-outline"
        circleBg={colors.cardYellow}
        iconColor={colors.accentDark}
        title="Ceny potravín"
        subtitle="Vlastné jednotkové ceny (len pre tvoj účet)"
        onPress={() => navigation.navigate('FoodPrices')}
        colors={colors}
        styles={styles}
      />

      <ActionCard
        icon="wallet-outline"
        circleBg={colors.cardPink}
        iconColor={colors.primary}
        title="Prehľad rozpočtu"
        subtitle="Sleduj minulé nákupy a aktuálny týždeň"
        onPress={() => navigation.navigate('Budget')}
        colors={colors}
        styles={styles}
      />

      <ActionCard
        icon="book-outline"
        circleBg={colors.cardBlue}
        iconColor={colors.info}
        title="Moje recepty"
        subtitle={
          myRecipesCount > 0
            ? `${myRecipesCount} ${myRecipesCount === 1 ? 'vlastný recept' : 'vlastné recepty'}`
            : 'Pridaj svoj prvý recept'
        }
        onPress={goRecipesMine}
        colors={colors}
        styles={styles}
      />

      <ActionCard
        icon="people-outline"
        circleBg={colors.cardGreen}
        iconColor={colors.secondaryDark}
        title="Zdieľaná domácnosť"
        subtitle="Pozvi členov a zdieľajte jeden zoznam"
        onPress={() => navigation.navigate('Household')}
        colors={colors}
        styles={styles}
      />

      <Text style={styles.sectionLabel}>Stravovanie a vybavenie</Text>
      <Card variant="white" paddingSize="medium" style={[styles.prefCard, shadows.small]}>
        <View style={styles.prefBlock}>
          <Text style={styles.prefBlockLabel}>Diétne obmedzenia</Text>
          <View style={styles.chipRow}>
            {DIETARY_PREF_OPTIONS.map((opt) => {
              const selected = dietaryPrefsEdit.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.selectChip, selected && styles.selectChipOn]}
                  onPress={() => toggleProfilePref('dietaryPrefs', opt)}
                  disabled={prefsSaving}
                  activeOpacity={0.85}
                >
                  {selected && (
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" style={styles.selectChipIcon} />
                  )}
                  <Text style={[styles.selectChipText, selected && styles.selectChipTextOn]}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={[styles.prefBlock, styles.prefBlockLast]}>
          <Text style={styles.prefBlockLabel}>Vybavenie kuchyne</Text>
          <View style={styles.chipRow}>
            {EQUIPMENT_OPTIONS.map((opt) => {
              const selected = equipmentEdit.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.selectChip, styles.selectChipEquip, selected && styles.selectChipEquipOn]}
                  onPress={() => toggleProfilePref('equipment', opt)}
                  disabled={prefsSaving}
                  activeOpacity={0.85}
                >
                  {selected && (
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" style={styles.selectChipIcon} />
                  )}
                  <Text style={[styles.selectChipText, selected && styles.selectChipTextOn]}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Card>

      <Card variant="white" paddingSize="medium" style={[styles.prefCard, shadows.small]}>
        <Text style={styles.prefBlockLabel}>Meno</Text>
        <TextInput
          style={[styles.storeInput, { marginBottom: spacing.md }]}
          value={displayName}
          onChangeText={setDisplayName}
          onBlur={() => saveDisplayName(displayName)}
          placeholder="napr. Alexandra"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.prefBlockLabel}>Obľúbená predajňa</Text>
        <Text style={styles.storeHint}>
          V nákupnom zozname uvidíš cenu z tejto predajne, ak je dostupná.
        </Text>
        <TextInput
          style={styles.storeInput}
          value={preferredStore}
          onChangeText={setPreferredStore}
          onBlur={() => savePreferredStore(preferredStore)}
          placeholder="napr. LIDL, KAUFLAND"
          placeholderTextColor={colors.textMuted}
        />
      </Card>

      <TouchableOpacity
        style={styles.signOutBtn}
        onPress={handleSignOut}
        activeOpacity={0.7}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.primary} />
        <Text style={styles.signOutText}>Odhlásiť sa</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// Reusable action card s ikonou, titulkom, subtextom a šípkou doprava.

function ActionCard({ icon, circleBg, iconColor, title, subtitle, onPress, colors, styles }) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.actionWrap}>
      <View style={[styles.actionCard, shadows.small]}>
        <View style={[styles.actionIconWrap, { backgroundColor: circleBg }]}>
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.actionSubtitle}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

function createProfileStyles(colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  loadingText: { ...typography.body, color: colors.textMuted },

  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundPrimary,
    padding: spacing.lg,
    borderRadius: radius.large,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  headerEmail: { ...typography.h4, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.md,
  },
  statLabel: { ...typography.caption, color: colors.textMuted },
  statValue: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xs },

  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  appearanceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  appearanceChip: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.medium,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.backgroundPrimary,
    alignItems: 'center',
  },
  appearanceChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceHighlight,
  },
  appearanceChipText: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  appearanceChipTextActive: {
    color: colors.primary,
  },

  actionWrap: { marginBottom: spacing.md },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundPrimary,
    padding: spacing.md,
    borderRadius: radius.large,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  actionSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  prefCard: { marginBottom: spacing.md },
  prefBlock: { marginBottom: spacing.md },
  prefBlockLast: { marginBottom: 0 },
  prefBlockLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  prefHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.large,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.backgroundPrimary,
  },
  selectChipEquip: {
    backgroundColor: colors.cardGreen,
    borderColor: colors.cardGreen,
  },
  selectChipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  selectChipEquipOn: {
    borderColor: colors.secondaryDark,
    backgroundColor: colors.secondaryDark,
  },
  selectChipIcon: { marginRight: 4 },
  selectChipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  selectChipTextOn: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  storeHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  storeInput: {
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  signOutBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1.5,
    borderColor: colors.primaryLight,
    ...shadows.small,
  },
  signOutText: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
}
