// Týždenný plán jedál (Firestore plans/{uid}/weeks/{isoWeek}).
import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Modal,
  Pressable,
  Alert,
  Switch,
  RefreshControl,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import { useAuthUser } from '../hooks/useAuthUser';
import { usePantry } from '../hooks/usePantry';
import { useProfile } from '../hooks/useProfile';
import { useShoppingList } from '../hooks/useShoppingList';
import {
  getWeekPlan,
  removeMealAt,
  updateMealServings,
  getWeekId,
} from '../services/firestore/plans';
import { getRecipe, peekRecipeFromCache } from '../services/firestore/recipes';
import { estimateRecipeCost } from '../services/pricing/recipeCost';
import { aggregateIngredientsFromRecipes } from '../utils/generateShoppingList';
import { openRecipeDetail } from '../navigation/recipeNavigation';
import { usePlanCost } from '../hooks/usePrices';
import { buildPantryIndex } from '../services/pricing/pantryIndex';
import { getPlanningWeekDates } from '../utils/dateHelpers';

const DAY_NAMES_BY_JS_DAY = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];
const MEAL_LABELS = { breakfast: 'Raňajky', lunch: 'Obed', dinner: 'Večera' };
const WEEKDAY_SHORT = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];

// Rozsah dátumov týždňa do jedného riadku (bez opakovania názvu obrazovky v hlavičke).

function formatWeekRangeSk(weekDates) {
  if (!weekDates?.length) return '';
  const start = new Date(`${weekDates[0]}T12:00:00`);
  const end = new Date(`${weekDates[weekDates.length - 1]}T12:00:00`);
  const sameYear = start.getFullYear() === end.getFullYear();
  const a = start.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
  const b = end.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
  if (sameYear) {
    const y = end.getFullYear();
    return `${a} – ${b} ${y}`;
  }
  return `${a} ${start.getFullYear()} – ${b} ${end.getFullYear()}`;
}

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES_BY_JS_DAY[d.getDay()];
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, delta) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function getCalendarCells(monthDate) {
  const monthStart = startOfMonth(monthDate);
  const firstWeekday = (monthStart.getDay() + 6) % 7; // Monday=0
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - firstWeekday);
  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    out.push({
      date: d,
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      inMonth: d.getMonth() === monthStart.getMonth(),
    });
  }
  return out;
}

export default function PlanScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createPlanStyles(colors), [colors]);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile } = useProfile(uid);
  const householdId = profile?.activeHouseholdId || null;
  const { createList, updateItems } = useShoppingList(uid, { householdId });
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const weekDates = useMemo(() => getPlanningWeekDates(anchorDate), [anchorDate]);
  const weekRangeLabel = useMemo(() => formatWeekRangeSk(weekDates), [weekDates]);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const { items: pantryItems } = usePantry(uid);
  const [planDays, setPlanDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadedOnceRef = React.useRef(false);
  const [roundToPackages, setRoundToPackages] = useState(false);
  const visiblePlanDays = useMemo(
    () => (planDays || []).filter((d) => weekDates.includes(d.date)),
    [planDays, weekDates]
  );
  const weekPlanForCost = useMemo(() => ({ days: visiblePlanDays }), [visiblePlanDays]);
  const { totalEur: planCostTotal, savedByPantry: planSavedByPantry, unresolved: planUnresolved, loading: planCostLoading } = usePlanCost(weekPlanForCost, profile, pantryItems, roundToPackages, uid);

  const weekIds = useMemo(
    () => Array.from(new Set(weekDates.map((dateStr) => getWeekId(new Date(`${dateStr}T00:00:00`))))),
    [weekDates]
  );

  const refetchPlans = useCallback(async () => {
    if (!uid) {
      setPlanDays([]);
      setLoading(false);
      return;
    }
    if (!loadedOnceRef.current && (planDays || []).length === 0) {
      setLoading(true);
    }
    const plans = await Promise.all(weekIds.map((ww) => getWeekPlan(uid, ww)));
    const mergedByDate = new Map();
    plans.forEach((p) => {
      (p?.days ?? []).forEach((d) => mergedByDate.set(d.date, d));
    });
    const ordered = Array.from(mergedByDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    setPlanDays(ordered);
    loadedOnceRef.current = true;
    setLoading(false);
  }, [uid, weekIds, planDays]);

  // obnova plánu po návrate z detailu receptu
  useFocusEffect(
    useCallback(() => {
      refetchPlans();
    }, [refetchPlans]),
  );

  const handlePullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refetchPlans();
    } finally {
      setPullRefreshing(false);
    }
  }, [refetchPlans]);

  const [recipeCache, setRecipeCache] = useState({});
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedDates, setSelectedDates] = useState({});
  const [generating, setGenerating] = useState(false);
  const calendarCells = useMemo(() => getCalendarCells(calendarMonth), [calendarMonth]);

  // Mapuje dátum → meal entries (vždy v jednotnom tvare `{ recipeId, servings }`).
  // Stringy zo starého formátu sa konvertujú na entry s `servings: null`.
  const daysWithMeals = useMemo(() => {
    function normEntry(e) {
      if (!e) return null;
      if (typeof e === 'string') return { recipeId: e, servings: null };
      const recipeId = String(e.recipeId || '').trim();
      if (!recipeId) return null;
      const raw = Number(e.servings);
      const servings = Number.isFinite(raw) && raw > 0 ? raw : null;
      return { recipeId, servings };
    }
    function normList(list) {
      return (list || []).map(normEntry).filter(Boolean);
    }
    const map = {};
    weekDates.forEach((dateStr) => {
      map[dateStr] = { breakfast: [], lunch: [], dinner: [] };
    });
    (planDays ?? []).forEach((d) => {
      if (!map[d.date]) return;
      const day = d.meals ?? { breakfast: [], lunch: [], dinner: d.recipes ?? [] };
      if (d.recipes?.length && !day.dinner?.length) day.dinner = d.recipes;
      map[d.date] = {
        breakfast: normList(day.breakfast),
        lunch: normList(day.lunch),
        dinner: normList(day.dinner),
      };
    });
    return map;
  }, [planDays, weekDates]);

  const allRecipeIds = useMemo(() => {
    const ids = new Set();
    Object.values(daysWithMeals).forEach((meals) => {
      ['breakfast', 'lunch', 'dinner'].forEach((key) =>
        (meals[key] || []).forEach((entry) => ids.add(entry.recipeId)),
      );
    });
    return Array.from(ids);
  }, [daysWithMeals]);

  const pantryIndex = useMemo(
    () => buildPantryIndex(pantryItems || []),
    [pantryItems]
  );

  // názov/obrázok z module cache (bez blinku recipeId)
  React.useEffect(() => {
    if (allRecipeIds.length === 0) return;
    setRecipeCache((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of allRecipeIds) {
        const existing = next[id];
        if (existing?.name && existing.name !== id && existing.imageUrl !== undefined) continue;
        const r = peekRecipeFromCache(id);
        if (!r) continue;
        next[id] = {
          name: r.name ?? id,
          imageUrl: r.imageUrl ?? null,
          pricePerPortion: existing?.pricePerPortion ?? null,
          nominalServings: Math.max(1, Number(r.servings) || 1),
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [allRecipeIds.join(',')]);

  React.useEffect(() => {
    if (allRecipeIds.length === 0) return;
    let cancelled = false;
    const prefer = profile?.preferredStore ?? null;

    (async () => {
      // Najprv spravíme rýchly batch: dotiahneme metadata receptov, ktoré ešte
      // nemajú meno v cache. Toto je rýchle (1 read na recept, často z cache).
      const meta = await Promise.all(
        allRecipeIds.map(async (id) => {
          const r = await getRecipe(id);
          return { id, recipe: r };
        }),
      );
      if (cancelled) return;
      setRecipeCache((prev) => {
        const next = { ...prev };
        for (const { id, recipe } of meta) {
          const existing = next[id];
          next[id] = {
            name: recipe?.name ?? existing?.name ?? id,
            imageUrl: recipe?.imageUrl ?? existing?.imageUrl ?? null,
            pricePerPortion: existing?.pricePerPortion ?? null,
            nominalServings: Math.max(1, Number(recipe?.servings) || existing?.nominalServings || 1),
          };
        }
        return next;
      });

      // ceny paralelne, postupný zápis do cache
      await Promise.all(
        meta.map(async ({ id, recipe }) => {
          if (cancelled || !recipe) return;
          const nominalServings = Math.max(1, Number(recipe.servings) || 1);
          const est = await estimateRecipeCost(recipe, nominalServings, pantryIndex, prefer, uid);
          if (cancelled) return;
          setRecipeCache((prev) => ({
            ...prev,
            [id]: {
              ...(prev[id] || {}),
              name: recipe.name ?? prev[id]?.name ?? id,
              imageUrl: recipe.imageUrl ?? prev[id]?.imageUrl ?? null,
              pricePerPortion: est?.perServing ?? null,
              nominalServings,
            },
          }));
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [allRecipeIds.join(','), pantryIndex, profile?.preferredStore, uid]);

  const totalMeals = useMemo(() => {
    let n = 0;
    Object.values(daysWithMeals).forEach((meals) => {
      n +=
        (meals.breakfast?.length ?? 0) +
        (meals.lunch?.length ?? 0) +
        (meals.dinner?.length ?? 0);
    });
    return n;
  }, [daysWithMeals]);

  // Vráti počet porcií, ktoré sa naplánovali pre dané meal entry.

  const getEntryServings = useCallback(
    (entry) => {
      if (!entry) return 1;
      if (entry.servings != null && entry.servings > 0) return entry.servings;
      const nominal = recipeCache[entry.recipeId]?.nominalServings;
      return nominal && nominal > 0 ? nominal : 1;
    },
    [recipeCache],
  );

  const handleEntryServingsChange = useCallback(
    async (dateStr, mealType, index, nextServings) => {
      if (!uid) return;
      const safe = Math.max(1, Math.round(Number(nextServings) || 1));
      // Optimistická lokálna aktualizácia – aby sa cena prepočítala okamžite.
      setPlanDays((prev) =>
        prev.map((d) => {
          if (d.date !== dateStr) return d;
          const meals = { ...(d.meals || {}) };
          const list = [...(meals[mealType] || [])];
          if (!list[index]) return d;
          list[index] = { ...list[index], servings: safe };
          meals[mealType] = list;
          return { ...d, meals };
        }),
      );
      try {
        const ww = getWeekId(new Date(`${dateStr}T00:00:00`));
        await updateMealServings(uid, ww, dateStr, mealType, index, safe);
      } catch (err) {
        Alert.alert('Chyba', err?.message || 'Nepodarilo sa zmeniť počet porcií.');
        await refetchPlans();
      }
    },
    [uid, refetchPlans],
  );


  const openGenerateModal = useCallback(() => {
    const initial = {};
    weekDates.forEach((d) => {
      const meals = daysWithMeals[d] ?? { breakfast: [], lunch: [], dinner: [] };
      const hasMeals =
        (meals.breakfast?.length ?? 0) + (meals.lunch?.length ?? 0) + (meals.dinner?.length ?? 0) > 0;
      initial[d] = hasMeals;
    });
    if (Object.values(initial).every((v) => !v)) {
      weekDates.forEach((d) => (initial[d] = true));
    }
    setSelectedDates(initial);
    setShowGenerateModal(true);
  }, [weekDates, daysWithMeals]);

  const toggleDate = useCallback((dateStr) => {
    setSelectedDates((prev) => ({ ...prev, [dateStr]: !prev[dateStr] }));
  }, []);

  const openCalendar = useCallback(() => {
    setCalendarMonth(startOfMonth(anchorDate));
    setCalendarVisible(true);
  }, [anchorDate]);

  const chooseCalendarDate = useCallback((date) => {
    setAnchorDate(new Date(date));
    setCalendarVisible(false);
  }, []);

  const handleRemoveEntry = useCallback(
    async (dateStr, mealType, index) => {
      if (!uid) return;
      // Optimisticky odoberieme zo state pre okamžitú odozvu.
      setPlanDays((prev) =>
        prev.map((d) => {
          if (d.date !== dateStr) return d;
          const meals = { ...(d.meals || {}) };
          const list = [...(meals[mealType] || [])];
          if (index < 0 || index >= list.length) return d;
          list.splice(index, 1);
          meals[mealType] = list;
          return { ...d, meals };
        }),
      );
      try {
        const ww = getWeekId(new Date(`${dateStr}T00:00:00`));
        await removeMealAt(uid, ww, dateStr, mealType, index);
      } catch (err) {
        Alert.alert('Chyba', err?.message || 'Položku sa nepodarilo odstrániť.');
        await refetchPlans();
      }
    },
    [uid, refetchPlans],
  );

  const handleGenerateList = useCallback(async () => {
    const dates = weekDates.filter((d) => selectedDates[d]);
    if (dates.length === 0) {
      Alert.alert('Vyber aspoň jeden deň', 'Zvoľ dni, z ktorých sa vygeneruje nákupný zoznam.');
      return;
    }
    // Z plánu sčítame "scale" za každý recept – počet naplánovaných porcií / nominálne porcie.
    // Vďaka tomu sa do nákupného zoznamu generujú len suroviny pre toľko porcií, koľko si naozaj plánuješ uvariť.
    const recipeScales = {};
    dates.forEach((dateStr) => {
      const meals = daysWithMeals[dateStr] ?? { breakfast: [], lunch: [], dinner: [] };
      ['breakfast', 'lunch', 'dinner'].forEach((key) => {
        (meals[key] ?? []).forEach((entry) => {
          const id = entry.recipeId;
          const nominal = recipeCache[id]?.nominalServings || 1;
          const planned = entry.servings != null && entry.servings > 0 ? entry.servings : nominal;
          recipeScales[id] = (recipeScales[id] || 0) + planned / nominal;
        });
      });
    });
    const recipeIds = Object.keys(recipeScales);
    if (recipeIds.length === 0) {
      Alert.alert(
        'Žiadne recepty',
        'Na zvolených dňoch nie sú žiadne recepty. Pridaj jedlá do plánu.',
      );
      setShowGenerateModal(false);
      return;
    }
    setGenerating(true);
    try {
      const recipes = await Promise.all(recipeIds.map((id) => getRecipe(id)));
      const validRecipes = recipes.filter(Boolean);
      const items = aggregateIngredientsFromRecipes(validRecipes, recipeScales);
      const listId = await createList();
      await updateItems(listId, items);
      setShowGenerateModal(false);
      navigation.navigate('List');
    } catch (err) {
      Alert.alert('Chyba', err?.message || 'Zoznam sa nepodarilo vygenerovať.');
    } finally {
      setGenerating(false);
    }
  }, [
    weekDates,
    selectedDates,
    daysWithMeals,
    recipeCache,
    createList,
    updateItems,
    navigation,
  ]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Načítavam plán…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screenRoot}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, uid ? { paddingBottom: 96 } : {}]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={pullRefreshing} onRefresh={handlePullRefresh} tintColor={colors.primary} />
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="calendar" size={28} color="#FFFFFF" />
        </View>
        <Text style={styles.heroTitle}>{weekRangeLabel || 'Plán'}</Text>
        <Text style={styles.heroSubtitle}>
          Pridaj jedlá podľa dní a vygeneruj z nich nákup. 
        </Text>
      </View>
      <View style={styles.historyRow}>
        <TouchableOpacity
          style={styles.pillBtn}
          onPress={() => setAnchorDate(new Date())}
          activeOpacity={0.85}
        >
          <Ionicons name="today-outline" size={18} color={colors.primary} />
          <Text style={styles.pillBtnText}>Tento týždeň</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillBtn} onPress={openCalendar} activeOpacity={0.85}>
          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          <Text style={styles.pillBtnText}>Kalendár</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryPanel, styles.summaryPanelWide]}>
          <View style={styles.summaryPanelHeader}>
            <View style={styles.summaryPanelIcon}>
              <Ionicons name="wallet-outline" size={20} color={colors.primary} />
            </View>
            <Text style={styles.summaryPanelTitle}>Náklady týždňa</Text>
          </View>
          <Text style={styles.summaryValueLarge}>
            {planCostLoading
              ? '–––'
              : totalMeals === 0
                ? '0.00 €'
                : planCostTotal != null
                  ? `${planCostTotal.toFixed(2)} €`
                  : planUnresolved.length > 0
                    ? '– (neúplné ceny)'
                    : '0.00 €'}
          </Text>
          <Text style={styles.summaryLabel}>
            {pantryItems?.length ? 'Odhad nákupu' : 'Odhad nákladov'}
          </Text>
          {totalMeals > 0 && planSavedByPantry != null && planSavedByPantry > 0 && (
            <Text style={styles.summarySubtext}>V špajzi ušetríš −{planSavedByPantry.toFixed(2)} €</Text>
          )}
          {totalMeals > 0 && profile?.weeklyBudget && planCostTotal != null && (
            <Text style={[styles.summarySubtext, planCostTotal > profile.weeklyBudget && styles.summarySubtextWarning]}>
              {planCostTotal > profile.weeklyBudget
                ? `Nad rozpočtom o ${(planCostTotal - profile.weeklyBudget).toFixed(2)} €`
                : `Zostáva ${(profile.weeklyBudget - planCostTotal).toFixed(2)} € z rozpočtu`}
            </Text>
          )}
          <View style={styles.roundToggleRow}>
            <Text style={styles.roundToggleLabel}>Zaokrúhliť na balenia</Text>
            <Switch
              value={roundToPackages}
              onValueChange={setRoundToPackages}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.backgroundPrimary}
              style={styles.roundToggleSwitch}
            />
          </View>
        </View>
      </View>

      {totalMeals === 0 && (
        <View style={styles.emptyPlanCard}>
          <View style={styles.emptyPlanIcon}>
            <Ionicons name="restaurant-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyPlanTitle}>Tento týždeň je zatiaľ prázdny</Text>
            <Text style={styles.emptyPlanText}>Pridaj prvé jedlo z receptov a plán sa začne počítať automaticky.</Text>
          </View>
          <TouchableOpacity
            style={styles.emptyPlanBtn}
            onPress={() =>
              navigation.navigate('Recipes', {
                screen: 'RecipeList',
              })
            }
            activeOpacity={0.85}
          >
            <Text style={styles.emptyPlanBtnText}>Pridať</Text>
          </TouchableOpacity>
        </View>
      )}

      {weekDates.map((dateStr) => {
        const meals = daysWithMeals[dateStr] ?? { breakfast: [], lunch: [], dinner: [] };
        return (
          <View key={dateStr} style={styles.daySection}>
            <View style={styles.dayHeader}>
              <View style={styles.dayIconCircle}>
                <Ionicons name="sunny-outline" size={18} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.dayTitle}>{getDayName(dateStr)}</Text>
                <Text style={styles.dayDateSub}>{dateStr}</Text>
              </View>
            </View>
            {['breakfast', 'lunch', 'dinner'].map((mealType) => {
              const entries = meals[mealType] ?? [];
              return (
                <View key={mealType} style={styles.mealSlot}>
                  <Text style={styles.mealSlotLabel}>{MEAL_LABELS[mealType]}</Text>

                  {entries.length === 0 ? (
                    <View style={styles.mealEmpty}>
                      <Text style={styles.mealPlaceholder}>Žiadne jedlo</Text>
                    </View>
                  ) : (
                    entries.map((entry, recipeIdx) => {
                      const mealTypeLabel = MEAL_LABELS[mealType];
                      const recipeId = entry.recipeId;
                      const cached = recipeCache[recipeId];
                      const perPortion = cached?.pricePerPortion;
                      const portions = getEntryServings(entry);
                      const lineCost =
                        typeof perPortion === 'number' && perPortion >= 0
                          ? perPortion * portions
                          : null;
                      return (
                        <View
                          key={`${dateStr}-${mealType}-${recipeId}-${recipeIdx}`}
                          style={styles.mealRow}
                        >
                          {cached?.imageUrl ? (
                            <Image
                              source={{ uri: cached.imageUrl }}
                              style={styles.mealThumb}
                            />
                          ) : (
                            <View style={[styles.mealThumb, styles.mealThumbPlaceholder]} />
                          )}
                          <TouchableOpacity
                            style={styles.mealInfo}
                            onPress={() => openRecipeDetail(navigation, { recipeId })}
                          >
                            <Text style={styles.mealLabel} numberOfLines={1}>
                              {cached?.name ?? recipeId}
                            </Text>
                            <Text style={styles.mealPrice}>
                              {lineCost != null ? `${lineCost.toFixed(2)} € • ` : ''}
                              {mealTypeLabel}
                            </Text>
                          </TouchableOpacity>
                          <View style={styles.servingsControl}>
                            <TouchableOpacity
                              style={[styles.servingsCtrlBtn, portions <= 1 && styles.servingsCtrlBtnDisabled]}
                              onPress={() =>
                                handleEntryServingsChange(
                                  dateStr,
                                  mealType,
                                  recipeIdx,
                                  Math.max(1, portions - 1),
                                )
                              }
                              disabled={portions <= 1}
                            >
                              <Ionicons
                                name="remove"
                                size={18}
                                color={portions <= 1 ? '#94A3B8' : '#FFFFFF'}
                              />
                            </TouchableOpacity>
                            <Text style={styles.servingsCtrlValue}>{portions}</Text>
                            <TouchableOpacity
                              style={styles.servingsCtrlBtn}
                              onPress={() =>
                                handleEntryServingsChange(
                                  dateStr,
                                  mealType,
                                  recipeIdx,
                                  portions + 1,
                                )
                              }
                            >
                              <Ionicons name="add" size={18} color="#FFFFFF" />
                            </TouchableOpacity>
                          </View>
                          <TouchableOpacity
                            style={styles.trashBtn}
                            onPress={() => handleRemoveEntry(dateStr, mealType, recipeIdx)}
                            hitSlop={8}
                          >
                            <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}

                  <TouchableOpacity
                    style={styles.addMealBtnFull}
                    onPress={() =>
                      navigation.navigate('Recipes', {
                        screen: 'RecipeList',
                        params: {
                          addToPlanTarget: {
                            date: dateStr,
                            mealType,
                            _ts: Date.now(),
                          },
                        },
                      })
                    }
                  >
                    <Text style={styles.addMealBtnText}>
                      {entries.length === 0 ? '+ Pridať jedlo' : '+ Pridať ďalšie'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        );
      })}

    </ScrollView>

      {uid ? (
        <TouchableOpacity
          style={[
            styles.generateFab,
            {
              bottom: spacing.xs,
              left: spacing.lg + insets.left,
              right: spacing.lg + insets.right,
            },
          ]}
          onPress={openGenerateModal}
          activeOpacity={0.85}
          accessibilityLabel="Vygenerovať nákupný zoznam z plánu"
          accessibilityRole="button"
        >
          <Ionicons name="cart-outline" size={20} color="#FFFFFF" />
          <Text style={styles.generateFabText}>Vygenerovať nákupný zoznam</Text>
        </TouchableOpacity>
      ) : null}

      <Modal
        visible={showGenerateModal}
        transparent
        animationType="slide"
        onRequestClose={() => !generating && setShowGenerateModal(false)}
      >
        <Pressable style={styles.genModalOverlay} onPress={() => !generating && setShowGenerateModal(false)}>
          <Pressable style={styles.genSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.genSheetHeader}>
              <View style={styles.genSheetTitleRow}>
                <Ionicons name="list-circle-outline" size={22} color={colors.primary} />
                <Text style={styles.modalTitle}>Generovať z plánu</Text>
              </View>
              <TouchableOpacity onPress={() => !generating && setShowGenerateModal(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Označ dni, z ktorých sa pridajú suroviny do nákupného zoznamu.
            </Text>
            <View style={styles.modalDayList}>
              {weekDates.map((dateStr) => (
                <TouchableOpacity
                  key={dateStr}
                  style={[styles.modalDayRow, selectedDates[dateStr] && styles.modalDayRowActive]}
                  onPress={() => toggleDate(dateStr)}
                  disabled={generating}
                  activeOpacity={0.85}
                >
                  <View style={[styles.modalCheckbox, selectedDates[dateStr] && styles.modalCheckboxChecked]}>
                    {selectedDates[dateStr] && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                  </View>
                  <Text style={[styles.modalDayText, selectedDates[dateStr] && styles.modalDayTextActive]}>
                    {getDayName(dateStr)} {dateStr.slice(8, 10)}.{dateStr.slice(5, 7)}.
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.genModalActions}>
              <TouchableOpacity
                style={styles.genCancelBtn}
                onPress={() => setShowGenerateModal(false)}
                disabled={generating}
              >
                <Text style={styles.genCancelText}>Zrušiť</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.genPrimaryBtn, generating && { opacity: 0.7 }]}
                onPress={handleGenerateList}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="basket" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.genPrimaryText}>{generating ? 'Generujem…' : 'Generovať'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={calendarVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setCalendarVisible(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setCalendarMonth((m) => addMonths(m, -1))}>
                <Text style={styles.calendarArrow}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {calendarMonth.toLocaleDateString('sk-SK', { month: 'long', year: 'numeric' })}
              </Text>
              <TouchableOpacity onPress={() => setCalendarMonth((m) => addMonths(m, 1))}>
                <Text style={styles.calendarArrow}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.calendarWeekdays}>
              {WEEKDAY_SHORT.map((w) => (
                <Text key={w} style={styles.calendarWeekday}>{w}</Text>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {calendarCells.map((cell) => {
                const active = weekDates.includes(cell.iso);
                return (
                  <TouchableOpacity
                    key={cell.iso}
                    style={[
                      styles.calendarCell,
                      active && styles.calendarCellActive,
                      !cell.inMonth && styles.calendarCellMuted,
                    ]}
                    onPress={() => chooseCalendarDate(cell.date)}
                  >
                    <Text style={[styles.calendarCellText, active && styles.calendarCellTextActive]}>
                      {cell.date.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createPlanStyles(colors) {
  return StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: colors.backgroundSecondary },
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  loadingText: { ...typography.body, color: colors.textMuted, marginTop: spacing.md },
  hero: { alignItems: 'center', marginBottom: spacing.lg },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.medium,
  },
  heroTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  heroSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  historyRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  pillBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.borderDefault,
    ...shadows.small,
  },
  pillBtnText: { ...typography.body, color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  summaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl, alignItems: 'stretch' },
  summaryPanel: {
    flex: 1,
    borderRadius: radius.large,
    padding: spacing.lg,
    backgroundColor: colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    ...shadows.medium,
  },
  summaryPanelWide: { flex: 1 },
  summaryPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  summaryPanelIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tintPrimarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryPanelTitle: { ...typography.caption, fontWeight: '700', color: colors.textPrimary },
  summaryValueLarge: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.xs },
  summaryLabel: { ...typography.caption, color: colors.textMuted },
  summarySubtext: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  summarySubtextWarning: { color: colors.error || '#FF3B30' },
  emptyPlanCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.small,
  },
  emptyPlanIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tintPrimarySurface,
  },
  emptyPlanTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  emptyPlanText: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  emptyPlanBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
  },
  emptyPlanBtnText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
  roundToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: 36,
  },
  roundToggleLabel: { ...typography.caption, color: colors.textMuted, flex: 1, paddingRight: spacing.sm },
  roundToggleSwitch: { alignSelf: 'center' },
  daySection: {
    marginBottom: spacing.lg,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    ...shadows.medium,
  },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  dayIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tintPrimarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTitle: { ...typography.h4, color: colors.textPrimary, fontWeight: '700' },
  dayDateSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  mealSlot: { marginBottom: spacing.lg },
  mealSlotLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs, fontWeight: '600' },
  mealEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mealPlaceholder: { ...typography.caption, color: colors.textMuted },
  addMealBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  addMealBtnFull: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.xs,
  },
  addMealBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  servingsControl: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.xs,
    gap: 4,
  },
  servingsCtrlBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.small,
  },
  servingsCtrlBtnDisabled: { backgroundColor: colors.surfaceMuted },
  servingsCtrlValue: {
    ...typography.caption,
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
    fontWeight: '700',
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.medium,
  },
  mealThumb: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm },
  mealThumbPlaceholder: { backgroundColor: colors.cardBlue },
  mealInfo: { flex: 1 },
  mealLabel: { ...typography.body, color: colors.textPrimary },
  mealPrice: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  trashBtn: { padding: spacing.xs, marginLeft: spacing.xs },
  generateFab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 107, 157, 0.88)',
    borderRadius: radius.large,
    paddingVertical: spacing.md + 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.42)',
    zIndex: 30,
    elevation: 12,
    shadowColor: '#FF6B9D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
  },
  generateFabText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  genModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  genSheet: {
    backgroundColor: colors.backgroundPrimary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    maxHeight: '88%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderDefault,
    marginBottom: spacing.md,
  },
  genSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  genSheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  genModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderDefault,
  },
  genCancelBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.medium, backgroundColor: colors.backgroundSecondary, alignItems: 'center' },
  genCancelText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  genPrimaryBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    ...shadows.small,
  },
  genPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
    ...shadows.small,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary, fontSize: 18, marginBottom: 0 },
  modalSubtitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  modalDayList: { marginBottom: spacing.md },
  modalDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.medium,
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalDayRowActive: {
    backgroundColor: colors.surfaceIndigo,
    borderWidth: 1,
    borderColor: colors.borderIndigo,
  },
  modalCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCheckboxChecked: { backgroundColor: colors.primary },
  modalCheckmark: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  modalDayText: { ...typography.body, color: colors.textPrimary },
  modalDayTextActive: { fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end' },
  modalBtn: { flex: 1 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  calendarArrow: { ...typography.h3, color: colors.primary, paddingHorizontal: spacing.sm },
  calendarWeekdays: { flexDirection: 'row', marginBottom: spacing.xs },
  calendarWeekday: { flex: 1, textAlign: 'center', ...typography.caption, color: colors.textMuted },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: {
    width: '14.285%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.small,
  },
  calendarCellActive: { backgroundColor: colors.cardPink },
  calendarCellMuted: { opacity: 0.4 },
  calendarCellText: { ...typography.body, color: colors.textPrimary },
  calendarCellTextActive: { fontWeight: '700', color: colors.primary },
});
}
