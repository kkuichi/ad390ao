// Domov: odporúčania, rozpočet, rýchle odkazy.
import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  RefreshControl,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Card from '../components/ui/Card';
import AnimatedBudgetRing from '../components/ui/AnimatedBudgetRing';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import { usePlan } from '../hooks/usePlan';
import { usePantry } from '../hooks/usePantry';
import { recommendRecipes } from '../services/recommend/recommend';
import { getRecipe } from '../services/firestore/recipes';
import { getPurchaseHistoryBetween } from '../services/firestore/purchases';
import { getPlanningWeekId } from '../utils/dateHelpers';
import { getBudgetCycleRange, formatBudgetCycleRangeShort } from '../utils/budgetCycle';
import { openRecipeDetail } from '../navigation/recipeNavigation';
import { getBudgetRingColorFromUsage, getBudgetUsageRatio } from '../utils/budgetColors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(160, (SCREEN_WIDTH - spacing.lg * 2 - spacing.sm * 2) / 2);
const CARD_GAP = spacing.md;
const CARD_INTERVAL = CARD_WIDTH + CARD_GAP;
const H_LIST_VIEWPORT = SCREEN_WIDTH - spacing.lg * 2;
const H_LIST_SIDE_INSET = Math.max(0, (H_LIST_VIEWPORT - CARD_WIDTH) / 2);
const SKELETON_CARD_COUNT = 3;
function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Počet ingrediencií receptu, ktoré sú v špajzi.

function countPantryMatches(recipeIngredients, pantryNamesNormalized) {
  if (!recipeIngredients?.length || !pantryNamesNormalized?.size) return 0;
  let count = 0;
  for (const name of recipeIngredients) {
    const n = normalizeName(name);
    if (!n) continue;
    if (Array.from(pantryNamesNormalized).some((p) => p && (p.includes(n) || n.includes(p)))) count += 1;
  }
  return count;
}


export default function HomeScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(colors), [colors]);
  const navigation = useNavigation();
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile, loading: profileLoading } = useProfile(uid);
  const planWeekId = getPlanningWeekId(new Date());
  const { plan, weekId, loading: planLoading, refetch: refetchPlan } = usePlan(uid, planWeekId);
  const { items: pantryItems, refetch: refetchPantry } = usePantry(uid);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [recRefreshKey, setRecRefreshKey] = useState(0);

  const [quickRecipes, setQuickRecipes] = useState([]);
  const [budgetFriendly, setBudgetFriendly] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  const [recPool, setRecPool] = useState([]);
  const [recLoading, setRecLoading] = useState(true);
  const [completedWeekTotal, setCompletedWeekTotal] = useState(0);
  const quickScrollX = React.useRef(new Animated.Value(0)).current;
  const budgetScrollX = React.useRef(new Animated.Value(0)).current;
  const leftoversScrollX = React.useRef(new Animated.Value(0)).current;
  const pantryNamesNormalized = useMemo(
    () => new Set((pantryItems || []).map((p) => normalizeName(p.name))),
    [pantryItems]
  );

  const pantrySig = useMemo(
    () =>
      (pantryItems || [])
        .map((p) => `${p.name || ''}|${p.qty ?? ''}|${p.unit || ''}`)
        .sort()
        .join('#'),
    [pantryItems],
  );
  const dietarySig = useMemo(
    () => (profile?.dietaryPrefs || []).slice().sort().join(','),
    [profile?.dietaryPrefs],
  );
  const equipmentSig = useMemo(
    () => (profile?.equipment || []).slice().sort().join(','),
    [profile?.equipment],
  );

  useEffect(() => {
    let cancelled = false;
    setRecLoading(true);
    const pantryForRec = (pantryItems || []).map((p) => ({ name: p.name }));
    recommendRecipes(uid, { limit: 60, pantryItems: pantryForRec }).then((list) => {
      if (cancelled) return;

      const seen = new Set();
      const take = (cands, n) => {
        const out = [];
        for (const r of cands) {
          if (!r?.id || seen.has(r.id)) continue;
          out.push(r);
          seen.add(r.id);
          if (out.length >= n) break;
        }
        return out;
      };

      // 1) Odporúčané pre teba: top-3 podľa celkového skóre (poradie z hooku).
      const personal = take(list, 3);

      // 2) Rýchle recepty: najkratší čas prípravy (preferujeme ≤30 min, ale
      //    keby ich nebolo dosť, doplníme aj ďalšie zoradené podľa času).
      const quickPool = [...list]
        .filter((r) => typeof r.durationMin === 'number' && r.durationMin > 0)
        .sort((a, b) => a.durationMin - b.durationMin);
      const quick = take(quickPool, 4);

      // 3) Šetrné k rozpočtu: najnižšia odhadovaná cena za porciu.
      const budgetPool = [...list]
        .filter(
          (r) =>
            typeof r.pricePerPortionEstimate === 'number' &&
            r.pricePerPortionEstimate > 0,
        )
        .sort((a, b) => a.pricePerPortionEstimate - b.pricePerPortionEstimate);
      const budget = take(budgetPool, 4);

      setAiPicks(personal);
      setQuickRecipes(quick);
      setBudgetFriendly(budget);
      setRecPool(list);
      setRecLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, pantrySig, dietarySig, equipmentSig, profile?.weeklyBudget, profile?.preferredStore, recRefreshKey]);


  useFocusEffect(
    React.useCallback(() => {
      if (!uid) return;
      refetchPlan();
      let cancelled = false;
      const run = () => {
        const now = new Date();
        const { cycleStart, nextCycleStart } = getBudgetCycleRange(profile ?? {}, now);
        getPurchaseHistoryBetween(uid, cycleStart, nextCycleStart, 80).then((orders) => {
          if (cancelled) return;
          const budget = profile?.weeklyBudget ?? 50;
          const maxSane = budget * 10;
          let weekTotal = 0;
          orders.forEach((order) => {
            const amt = typeof order?.paidTotalEur === 'number'
              ? order.paidTotalEur
              : typeof order?.estTotalEur === 'number'
                ? order.estTotalEur
                : 0;
            if (amt > 0 && amt <= maxSane) weekTotal += amt;
          });
          setCompletedWeekTotal(Math.round(weekTotal * 100) / 100);
        });
      };
      run();
      const t = setTimeout(run, 800);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }, [uid, profile, refetchPlan])
  );

  const handlePullRefresh = React.useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([refetchPlan(), refetchPantry()]);
      setRecRefreshKey((k) => k + 1);
      if (!uid) return;
      const now = new Date();
      const { cycleStart, nextCycleStart } = getBudgetCycleRange(profile ?? {}, now);
      const orders = await getPurchaseHistoryBetween(uid, cycleStart, nextCycleStart, 80);
      const budget = profile?.weeklyBudget ?? 50;
      const maxSane = budget * 10;
      let weekTotal = 0;
      orders.forEach((order) => {
        const amt =
          typeof order?.paidTotalEur === 'number'
            ? order.paidTotalEur
            : typeof order?.estTotalEur === 'number'
              ? order.estTotalEur
              : 0;
        if (amt > 0 && amt <= maxSane) weekTotal += amt;
      });
      setCompletedWeekTotal(Math.round(weekTotal * 100) / 100);
    } finally {
      setPullRefreshing(false);
    }
  }, [uid, profile, refetchPlan, refetchPantry]);

  const budgetSpent = completedWeekTotal;
  const weeklyBudget = profileLoading ? null : (profile?.weeklyBudget ?? 50);
  const budgetRemaining = weeklyBudget != null ? Math.max(0, weeklyBudget - budgetSpent) : 0;
  const budgetPercent = weeklyBudget > 0 ? Math.min(100, (budgetSpent / weeklyBudget) * 100) : 0;
  const overBudget = weeklyBudget > 0 && budgetSpent > weeklyBudget + 1e-6;
  // Zvyšok ≤ 15 % limitu, alebo „málo eur“ absolútne – pri veľmi nízkom limite inak 15 % zlyhá (napr. 0,18 € z 1 € je > 15 %).

  const lowBudget =
    weeklyBudget > 0 &&
    !overBudget &&
    budgetRemaining > 0 &&
    (budgetRemaining <= weeklyBudget * 0.15 + 1e-6 || budgetRemaining <= 1);

  const budgetRingTint =
    weeklyBudget != null && weeklyBudget > 0
      ? getBudgetRingColorFromUsage(getBudgetUsageRatio(budgetSpent, weeklyBudget), colors)
      : colors.textMuted;

  const mealCount =
    plan?.days?.reduce((acc, d) => {
      const m = d.meals ?? {};
      const b = (m.breakfast?.length ?? 0) + (m.lunch?.length ?? 0) + (m.dinner?.length ?? 0);
      const r = d.recipes?.length ?? 0;
      return acc + (b > 0 ? b : r);
    }, 0) ?? 0;

  const goToRecipe = (recipeItem) => {
    openRecipeDetail(navigation, {
      recipeId: recipeItem?.id,
      initialRecipe: recipeItem,
    });
  };

  const goToRecipes = () => navigation.navigate('Recipes', { screen: 'RecipeList' });
  const goToPlan = () => navigation.navigate('Plan');
  const goToPantry = () => navigation.navigate('Pantry');
  const goToProfile = () => navigation.navigate('Profile');
  const displayName = useMemo(() => {
    const fromProfile = (profile?.displayName || '').trim();
    if (fromProfile) return fromProfile;
    const fromAuth = (user?.displayName || '').trim();
    if (fromAuth) return fromAuth;
    const local = (user?.email || '').split('@')[0] || '';
    if (!local) return '';
    return local.charAt(0).toUpperCase() + local.slice(1);
  }, [profile?.displayName, user?.displayName, user?.email]);
  const profileInitial = useMemo(() => {
    const src = (profile?.displayName || user?.displayName || user?.email || '').trim();
    if (!src) return '?';
    return src[0].toUpperCase();
  }, [profile?.displayName, user?.displayName, user?.email]);
  const goToBudget = () => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate('Budget');
    } else {
      navigation.navigate('Budget');
    }
  };

  const renderRecipeSkeletons = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
      {Array.from({ length: SKELETON_CARD_COUNT }).map((_, idx) => (
        <View key={`sk-${idx}`} style={[styles.recipeCard, styles.recipeCardSkeleton]}>
          <View style={[styles.recipeCardImage, styles.skeletonBlock]} />
          <View style={styles.recipeCardBody}>
            <View style={[styles.skeletonBlock, styles.skeletonLineTitle]} />
            <View style={[styles.skeletonBlock, styles.skeletonLineSub]} />
          </View>
        </View>
      ))}
    </ScrollView>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: spacing.sm }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={pullRefreshing} onRefresh={handlePullRefresh} tintColor={colors.primary} />
      }
    >
      {/* hlavička */}
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <View style={styles.headerGreetingRow}>
            <Text style={styles.headerGreeting}>
              {displayName ? `Ahoj, ${displayName}` : 'Ahoj!'}
            </Text>
            <Ionicons
              name="hand-right-outline"
              size={22}
              color={colors.primary}
              style={styles.headerGreetingIcon}
              accessible={false}
            />
          </View>
          <Text style={styles.headerTagline}>Lacné jedlá podľa tvojho rozpočtu a špajzy.</Text>
        </View>
        <TouchableOpacity onPress={goToProfile} style={styles.profileAvatar} hitSlop={8} activeOpacity={0.85}>
          <Text style={styles.profileAvatarText}>{profileInitial}</Text>
        </TouchableOpacity>
      </View>

      {!profileLoading && !overBudget && lowBudget && (
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={goToBudget}
          style={[styles.budgetAlertCard, shadows.small]}
          accessibilityRole="button"
          accessibilityLabel="Rozpočet sa míňa, otvoriť detail"
        >
          <View style={styles.budgetAlertIconCircle}>
            <Ionicons name="pulse-outline" size={22} color={colors.warning} />
          </View>
          <View style={styles.budgetAlertTextCol}>
            <Text style={styles.budgetAlertTitle}>Rozpočet sa míňa</Text>
            <Text style={styles.budgetAlertBody}>
              Zostáva ti {budgetRemaining.toFixed(2)} € z {weeklyBudget} € v tomto cykle.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* rozpočet týždňa */}
      <TouchableOpacity activeOpacity={0.85} onPress={goToBudget}>
        <View style={styles.budgetSection}>
          <View style={styles.budgetSectionHeader}>
            <View style={styles.budgetHeaderIconCircle}>
              <Ionicons name="wallet-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.budgetHeaderTextCol}>
              <Text style={styles.budgetHeaderTitle}>Tvoj rozpočet</Text>
              <Text style={styles.budgetHeaderSub}>Prehľad minutia v aktuálnom týždni</Text>
            </View>
          </View>
          <View style={styles.budgetRingWrap}>
            <AnimatedBudgetRing spent={budgetSpent} budget={weeklyBudget || 0} size={160} strokeWidth={14} />
          </View>
          <View style={styles.budgetStatBar}>
            <View style={styles.budgetStatCell}>
              <Text style={styles.budgetStatLabel}>Minuté</Text>
              <Text style={styles.budgetStatValue}>{budgetSpent.toFixed(2)} €</Text>
            </View>
            <View style={styles.budgetStatDivider} />
            <View style={styles.budgetStatCell}>
              <Text style={styles.budgetStatLabel}>Cieľ</Text>
              <Text style={styles.budgetStatValue}>{weeklyBudget != null ? `${weeklyBudget} €` : '—'}</Text>
            </View>
            <View style={styles.budgetStatDivider} />
            <View style={styles.budgetStatCell}>
              <Text style={styles.budgetStatLabel}>Zostáva</Text>
              <Text style={[styles.budgetStatValue, { color: budgetRingTint }]}>
                {weeklyBudget != null ? `${budgetRemaining.toFixed(2)} €` : '—'}
              </Text>
            </View>
          </View>
          <Text style={styles.budgetCycleLine}>
            Týždeň (po – ne): {formatBudgetCycleRangeShort(profile, new Date())}
          </Text>
          <Text style={styles.budgetDetailLink}>Otvoriť detail rozpočtu</Text>
        </View>
      </TouchableOpacity>

      {/* odkaz na týždenný plán */}
      <TouchableOpacity style={styles.planStrip} onPress={goToPlan} activeOpacity={0.85}>
        <View style={styles.planStripLeft}>
          <View style={styles.planStripIconCircle}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.planStripLabel}>Tento týždeň v pláne</Text>
            <Text style={styles.planStripValue}>
              {mealCount === 0
                ? 'Zatiaľ žiadne jedlá'
                : `${mealCount} ${mealCount === 1 ? 'jedlo' : mealCount < 5 ? 'jedlá' : 'jedál'}`}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </TouchableOpacity>

      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="flash-outline" size={20} color={colors.primary} style={styles.sectionIcon} />
          <Text style={styles.sectionTitle}>Rýchle recepty</Text>
        </View>
        <TouchableOpacity onPress={goToRecipes} style={styles.seeAllBtn} activeOpacity={0.7}>
          <Text style={styles.seeAll}>Všetky</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {recLoading ? (
        renderRecipeSkeletons()
      ) : quickRecipes.length === 0 ? (
        <Card variant="white" paddingSize="medium" style={[styles.placeholderCard, shadows.small]}>
          <Text style={styles.placeholderText}>Zatiaľ žiadne rýchle recepty (≤30 min).</Text>
        </Card>
      ) : (
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          snapToInterval={CARD_INTERVAL}
          decelerationRate="fast"
          disableIntervalMomentum
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: quickScrollX } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
        >
          {quickRecipes.map((r, idx) => (
            <Animated.View
              key={r.id}
              style={{
                transform: [
                  {
                    scale: quickScrollX.interpolate({
                      inputRange: [(idx - 1) * CARD_INTERVAL, idx * CARD_INTERVAL, (idx + 1) * CARD_INTERVAL],
                      outputRange: [0.88, 1.04, 0.88],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
                opacity: quickScrollX.interpolate({
                  inputRange: [(idx - 1) * CARD_INTERVAL, idx * CARD_INTERVAL, (idx + 1) * CARD_INTERVAL],
                  outputRange: [0.58, 1, 0.58],
                  extrapolate: 'clamp',
                }),
              }}
            >
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.recipeCard}
                onPress={() => goToRecipe(r)}
              >
                <View style={styles.recipeCardImageWrap}>
                  {r.imageUrl ? (
                    <Image source={{ uri: r.imageUrl }} style={styles.recipeCardImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.recipeCardImage, styles.recipeCardImagePlaceholder]}>
                      <Text style={styles.recipeCardPlaceholderEmoji}></Text>
                    </View>
                  )}
                  {r.durationMin != null && (
                    <View style={styles.recipeCardTimePill}>
                      <Ionicons name="time-outline" size={12} color="#FFF" />
                      <Text style={styles.recipeCardTimePillText}>{r.durationMin} min</Text>
                    </View>
                  )}
                </View>
                <View style={styles.recipeCardBody}>
                  <Text style={styles.recipeCardName} numberOfLines={2}>
                    {r.name}
                  </Text>
                  {r.pricePerPortionEstimate != null && (
                    <Text style={styles.recipeCardPrice}>~ {r.pricePerPortionEstimate.toFixed(2)} € / por.</Text>
                  )}
                </View>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </Animated.ScrollView>
      )}

      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="wallet-outline" size={20} color={colors.primary} style={styles.sectionIcon} />
          <Text style={styles.sectionTitle}>Šetrné k rozpočtu</Text>
        </View>
        <TouchableOpacity onPress={goToRecipes} style={styles.seeAllBtn} activeOpacity={0.7}>
          <Text style={styles.seeAll}>Všetky</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {recLoading ? (
        renderRecipeSkeletons()
      ) : budgetFriendly.length === 0 ? (
        <Card variant="white" paddingSize="medium" style={[styles.placeholderCard, shadows.small]}>
          <Text style={styles.placeholderText}>Recepty s odhadom ceny sa zobrazia tu.</Text>
        </Card>
      ) : (
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          snapToInterval={CARD_INTERVAL}
          decelerationRate="fast"
          disableIntervalMomentum
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: budgetScrollX } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
        >
          {budgetFriendly.map((r, idx) => (
            <Animated.View
              key={r.id}
              style={{
                transform: [
                  {
                    scale: budgetScrollX.interpolate({
                      inputRange: [(idx - 1) * CARD_INTERVAL, idx * CARD_INTERVAL, (idx + 1) * CARD_INTERVAL],
                      outputRange: [0.88, 1.04, 0.88],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
                opacity: budgetScrollX.interpolate({
                  inputRange: [(idx - 1) * CARD_INTERVAL, idx * CARD_INTERVAL, (idx + 1) * CARD_INTERVAL],
                  outputRange: [0.58, 1, 0.58],
                  extrapolate: 'clamp',
                }),
              }}
            >
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.recipeCard}
                onPress={() => goToRecipe(r)}
              >
                <View style={styles.recipeCardImageWrap}>
                  {r.imageUrl ? (
                    <Image source={{ uri: r.imageUrl }} style={styles.recipeCardImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.recipeCardImage, styles.recipeCardImagePlaceholder]}>
                      <Text style={styles.recipeCardPlaceholderEmoji}></Text>
                    </View>
                  )}
                  {r.durationMin != null && (
                    <View style={styles.recipeCardTimePill}>
                      <Ionicons name="time-outline" size={12} color="#FFF" />
                      <Text style={styles.recipeCardTimePillText}>{r.durationMin} min</Text>
                    </View>
                  )}
                </View>
                <View style={styles.recipeCardBody}>
                  <Text style={styles.recipeCardName} numberOfLines={2}>
                    {r.name}
                  </Text>
                  {r.pricePerPortionEstimate != null && (
                    <Text style={styles.recipeCardPrice}>~ {r.pricePerPortionEstimate.toFixed(2)} € / por.</Text>
                  )}
                </View>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </Animated.ScrollView>
      )}

      {!recLoading && recPool.length > 0 && pantryNamesNormalized.size > 0 && (() => {
        const usedIds = new Set([
          ...aiPicks.map((r) => r.id),
          ...quickRecipes.map((r) => r.id),
          ...budgetFriendly.map((r) => r.id),
        ]);
        const leftover = recPool
          .filter((r) => !usedIds.has(r.id))
          .map((r) => ({ r, n: countPantryMatches(r.ingredients, pantryNamesNormalized) }))
          .filter(({ n }) => n > 0)
          .sort((a, b) => b.n - a.n)
          .slice(0, 4)
          .map(({ r }) => r);
        if (leftover.length === 0) return null;
        return (
          <>
            <View style={styles.sectionHead}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="basket-outline" size={20} color={colors.primary} style={styles.sectionIcon} />
                <Text style={styles.sectionTitle}>Využi zvyšky</Text>
              </View>
              <TouchableOpacity onPress={goToPantry} style={styles.seeAllBtn} activeOpacity={0.7}>
                <Text style={styles.seeAll}>Špajza</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              snapToInterval={CARD_INTERVAL}
              decelerationRate="fast"
              disableIntervalMomentum
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: leftoversScrollX } } }],
                { useNativeDriver: true }
              )}
              scrollEventThrottle={16}
            >
              {leftover.map((r, idx) => (
                <Animated.View
                  key={r.id}
                  style={{
                    transform: [
                      {
                        scale: leftoversScrollX.interpolate({
                          inputRange: [(idx - 1) * CARD_INTERVAL, idx * CARD_INTERVAL, (idx + 1) * CARD_INTERVAL],
                          outputRange: [0.88, 1.04, 0.88],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                    opacity: leftoversScrollX.interpolate({
                      inputRange: [(idx - 1) * CARD_INTERVAL, idx * CARD_INTERVAL, (idx + 1) * CARD_INTERVAL],
                      outputRange: [0.58, 1, 0.58],
                      extrapolate: 'clamp',
                    }),
                  }}
                >
                <TouchableOpacity activeOpacity={0.9} style={styles.recipeCard} onPress={() => goToRecipe(r)}>
                  <View style={styles.recipeCardImageWrap}>
                    {r.imageUrl ? (
                      <Image source={{ uri: r.imageUrl }} style={styles.recipeCardImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.recipeCardImage, styles.recipeCardImagePlaceholder]}>
                        <Text style={styles.recipeCardPlaceholderEmoji}></Text>
                      </View>
                    )}
                    <View style={[styles.recipeCardTimePill, styles.recipeCardPantryPill]}>
                      <Ionicons name="basket-outline" size={12} color={colors.success} />
                      <Text style={styles.recipeCardPantryPillText}>
                        {countPantryMatches(r.ingredients, pantryNamesNormalized)} v špajzi
                      </Text>
                    </View>
                  </View>
                  <View style={styles.recipeCardBody}>
                    <Text style={styles.recipeCardName} numberOfLines={2}>{r.name}</Text>
                    {r.pricePerPortionEstimate != null && (
                      <Text style={styles.recipeCardPrice}>~ {r.pricePerPortionEstimate.toFixed(2)} € / por.</Text>
                    )}
                  </View>
                </TouchableOpacity>
                </Animated.View>
              ))}
            </Animated.ScrollView>
          </>
        );
      })()}

      <View style={styles.actionRow}>
        <TouchableOpacity activeOpacity={0.9} style={styles.actionCardWrap} onPress={goToPlan}>
          <View style={styles.actionCardPanel}>
            <View style={styles.actionIconCircle}>
              <Ionicons name="calendar" size={22} color={colors.primary} />
            </View>
            <Text style={styles.actionCardTitle}>Týždenný plán</Text>
            <Text style={styles.actionCardSub}>Naplánuj si jedlá</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} style={styles.actionCardWrap} onPress={goToPantry}>
          <View style={styles.actionCardPanel}>
            <View style={styles.actionIconCircleGreen}>
              <Ionicons name="basket" size={22} color={colors.success || colors.primary} />
            </View>
            <Text style={styles.actionCardTitle}>Špajza</Text>
            <Text style={styles.actionCardSub}>Využij suroviny</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="star-outline" size={20} color={colors.primary} style={styles.sectionIcon} />
          <Text style={styles.sectionTitle}>Odporúčané pre teba</Text>
        </View>
        <TouchableOpacity onPress={goToRecipes} style={styles.seeAllBtn} activeOpacity={0.7}>
          <Text style={styles.seeAll}>Všetky</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {recLoading ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
      ) : aiPicks.length === 0 ? (
        <Card variant="white" paddingSize="medium" style={[styles.placeholderCard, shadows.small]}>
          <Text style={styles.placeholderText}>Zatiaľ žiadne recepty.</Text>
        </Card>
      ) : (
        <>
          {aiPicks.slice(0, 3).map((r, index) => {
            const pantryCount = countPantryMatches(r.ingredients, pantryNamesNormalized);
            return (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.9}
                onPress={() => goToRecipe(r)}
                style={styles.aiCardWrap}
              >
                <View style={styles.aiCardPanel}>
                  <View style={styles.aiCardLeft}>
                    {r.imageUrl ? (
                      <Image source={{ uri: r.imageUrl }} style={styles.aiCardImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.aiCardImage, styles.aiCardImagePlaceholder]}>
                        <Text style={styles.recipeCardPlaceholderEmoji}></Text>
                      </View>
                    )}
                    <View style={styles.aiCardBadge}>
                      <Text style={styles.aiCardBadgeText}>#{index + 1}</Text>
                    </View>
                  </View>
                  <View style={styles.aiCardRight}>
                    <Text style={styles.aiCardName} numberOfLines={2}>{r.name}</Text>
                    <View style={styles.aiCardMeta}>
                      {r.pricePerPortionEstimate != null && (
                        <Text style={styles.aiCardPrice}>~ {r.pricePerPortionEstimate.toFixed(2)} €</Text>
                      )}
                      {r.durationMin != null && (
                        <View style={styles.aiCardTimeRow}>
                          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                          <Text style={styles.aiCardTime}>{r.durationMin} min</Text>
                        </View>
                      )}
                    </View>
                    {pantryCount > 0 && (
                      <Text style={styles.aiCardPantry}>Používa {pantryCount} zo špajzi</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.aiSubline}>Odporúčania podľa rozpočtu, špajzy a preferencií.</Text>
        </>
      )}

    </ScrollView>
  );
}

function createHomeStyles(colors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.cardPink,
    marginHorizontal: -spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    borderBottomLeftRadius: radius.large,
    borderBottomRightRadius: radius.large,
  },
  headerTextWrap: { flex: 1, paddingRight: spacing.sm },
  headerGreetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  headerGreeting: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  headerGreetingIcon: {
    marginLeft: spacing.sm,
    marginTop: 2,
  },
  headerTagline: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.backgroundPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    ...shadows.small,
  },
  profileAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },

  budgetAlertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  budgetAlertIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tintWarningSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetAlertTextCol: { flex: 1, minWidth: 0 },
  budgetAlertTitle: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  budgetAlertBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 20,
    fontSize: 13,
  },
  budgetSection: {
    marginTop: spacing.lg,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.medium,
  },
  budgetSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  budgetHeaderIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 107, 157, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetHeaderTextCol: { flex: 1 },
  budgetHeaderTitle: { ...typography.h4, color: colors.textPrimary, fontWeight: '700' },
  budgetHeaderSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  budgetStatBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.medium,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  budgetStatCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  budgetStatDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  budgetStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  budgetStatValue: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  planStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.backgroundPrimary,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.medium,
  },
  planStripIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 107, 157, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planStripLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  planStripLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  planStripValue: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  budgetCycleLine: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  budgetRingWrap: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  budgetDetailLink: { ...typography.caption, color: colors.primary, fontWeight: '600', marginTop: spacing.md, textAlign: 'center' },

  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  sectionIcon: { marginRight: spacing.xs },
  sectionTitle: {
    ...typography.h4,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAll: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  horizontalList: {
    paddingLeft: 0,
    paddingRight: H_LIST_SIDE_INSET,
    gap: spacing.md,
  },
  recipeCard: {
    width: CARD_WIDTH,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.medium,
  },
  recipeCardImageWrap: {
    position: 'relative',
    width: '100%',
  },
  recipeCardImage: {
    width: '100%',
    height: CARD_WIDTH * 0.72,
    backgroundColor: colors.backgroundSecondary,
  },
  recipeCardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeCardPlaceholderEmoji: { fontSize: 32 },
  recipeCardTimePill: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.small,
  },
  recipeCardTimePillText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  recipeCardPantryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  recipeCardPantryPillText: { fontSize: 11, fontWeight: '600', color: colors.success },
  recipeCardBody: { padding: spacing.sm, paddingTop: spacing.md },
  recipeCardName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  recipeCardPrice: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  recipeCardSkeleton: {
    ...shadows.small,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceHighlight,
  },
  skeletonLineTitle: {
    height: 14,
    borderRadius: 7,
    width: '88%',
    marginBottom: spacing.xs,
  },
  skeletonLineSub: {
    height: 11,
    borderRadius: 6,
    width: '60%',
  },

  placeholderCard: { marginBottom: spacing.sm },
  placeholderText: { ...typography.body, color: colors.textMuted },
  loader: { marginVertical: spacing.md },

  actionRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  actionCardWrap: { flex: 1 },
  actionCardPanel: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.medium,
  },
  actionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 107, 157, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  actionIconCircleGreen: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(82, 136, 102, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  actionCardTitle: { ...typography.h4, color: colors.textPrimary, fontSize: 15 },
  actionCardSub: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  aiCardWrap: { marginBottom: spacing.md },
  aiCardPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.medium,
  },
  aiCardLeft: { position: 'relative' },
  aiCardImage: {
    width: 80,
    height: 80,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundSecondary,
  },
  aiCardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCardBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.small,
  },
  aiCardBadgeText: {
    ...typography.small,
    color: colors.backgroundPrimary,
    fontWeight: '700',
  },
  aiCardRight: {
    flex: 1,
    marginLeft: spacing.md,
    justifyContent: 'center',
  },
  aiCardName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  aiCardMeta: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.sm, flexWrap: 'wrap' },
  aiCardPrice: { ...typography.body, color: colors.primary, fontWeight: '600' },
  aiCardTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aiCardTime: { ...typography.caption, color: colors.textMuted },
  aiCardPantry: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  aiSubline: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },

  });
}
