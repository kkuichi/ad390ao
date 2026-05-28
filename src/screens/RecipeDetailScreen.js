// Detail receptu: suroviny, cena, špajza, pridanie do plánu.
import React, { useEffect, useState, useMemo, useCallback, useLayoutEffect } from 'react';
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
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import { getRecipe, deleteUserRecipe } from '../services/firestore/recipes';
import { useAuthUser } from '../hooks/useAuthUser';
import { usePantry } from '../hooks/usePantry';
import { useRecipePrice } from '../hooks/useRecipePrice';
import { findCheaperAlternativesForRecipe } from '../services/pricing/cheaperAlternatives';
import { useProfile } from '../hooks/useProfile';
import { getProfile } from '../services/firestore/profiles';
import { addRecipeToPlan, getWeekId } from '../services/firestore/plans';
import {
  buildUserShoppingContext,
  buildHouseholdShoppingContext,
  getShoppingLists,
  createShoppingList,
  addItemsToList,
} from '../services/firestore/shoppingLists';
import { getPlanningWeekDates } from '../utils/dateHelpers';

const MEAL_LABELS = { breakfast: 'Raňajky', lunch: 'Obed', dinner: 'Večera' };

const DAY_NAMES_BY_JS_DAY = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
function shortDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return DAY_NAMES_BY_JS_DAY[d.getDay()];
}


export default function RecipeDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createRecipeDetailStyles(colors), [colors]);
  const recipeId = route.params?.recipeId;
  const initialRecipe = route.params?.initialRecipe || null;
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile, updateProfile } = useProfile(uid);
  const householdId = profile?.activeHouseholdId || null;
  const { items: pantryItems, add: addPantryItem, refetch: refetchPantry } = usePantry(uid);

  const [recipe, setRecipe] = useState(initialRecipe);
  const [loading, setLoading] = useState(!initialRecipe);
  const [imageFailed, setImageFailed] = useState(false);
  const [error, setError] = useState(null);
  const [servings, setServings] = useState(1);
  const [adding, setAdding] = useState(null);
  const [showAddToPlanModal, setShowAddToPlanModal] = useState(false);
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [cheaperAlternatives, setCheaperAlternatives] = useState([]);
  const weekDates = useMemo(() => getPlanningWeekDates(), [recipeId]);
  // Mapa dátum → bool (zaškrtnuté). Používateľ môže vybrať aj viac dní naraz.
  const [planDates, setPlanDates] = useState({});
  const [planMealType, setPlanMealType] = useState('dinner');

  const recipePriceOpts = useMemo(
    () => ({ pantryItems, preferredStore: profile?.preferredStore }),
    [pantryItems, profile?.preferredStore]
  );
  const { loading: priceLoading, perServing, total, lineItems } = useRecipePrice(recipeId, servings, uid, recipePriceOpts);

  // Pri každom návrate na obrazovku znovu načítame špajzu, aby sa zmeny (pridanie/odobratie
  // položiek na PantryScreen, dokončený nákup) okamžite premietli do badge „V špajzi".
  useFocusEffect(
    React.useCallback(() => {
      refetchPantry();
      if (!recipeId) {
        setRecipe(null);
        setLoading(false);
        setError(null);
        return;
      }
      let cancelled = false;
      // SWR: keď už recept máme, neschovávame celý obsah počas revalidácie
      // (inak na chvíľu "zmizne" aj obrázok a znovu naskočí).
      if (!recipe) setLoading(true);
      setError(null);
      getRecipe(recipeId)
        .then((r) => {
          if (cancelled) return;
          setRecipe(r ?? null);
          setServings(Math.max(1, r?.servings ?? 1));
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setRecipe(null);
          setError(err?.message || 'Recept sa nepodarilo načítať.');
          setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [recipeId, refetchPantry, recipe])
  );

  React.useEffect(() => {
    setImageFailed(false);
  }, [recipeId, recipe?.imageUrl]);

  const rid = recipeId != null ? String(recipeId) : '';
  const isFavorite = (profile?.favoriteRecipeIds || []).some((x) => String(x) === rid);
  const toggleFavorite = useCallback(async () => {
    if (!uid || !rid) return;
    try {
      const base = (profile != null ? profile : await getProfile(uid)) || {};
      const raw = base.favoriteRecipeIds;
      const normalized = Array.isArray(raw) ? raw.map((x) => String(x)) : [];
      const had = normalized.includes(rid);
      const nextIds = had
        ? normalized.filter((id) => id !== rid)
        : [...new Set([...normalized, rid])];
      await updateProfile({ favoriteRecipeIds: nextIds }, { mergeFrom: base });
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa uložiť obľúbené.');
    }
  }, [uid, rid, profile, updateProfile]);

  useLayoutEffect(() => {
    if (!recipeId) return;
    const goToRecipeList = () => {
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('RecipeList');
      }
    };
    // Obľúbené je na fotke v pravom hornom rohu – v hlavičke nechávame čisté miesto.
    navigation.setOptions({
      headerRight: () => null,
      headerLeft: () => (
        <TouchableOpacity
          onPress={goToRecipeList}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingRight: spacing.xs }}
          accessibilityLabel="Späť na recepty"
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, recipeId, colors.primary]);

  const handleDeleteRecipe = useCallback(() => {
    if (!uid || !recipeId) return;
    Alert.alert('Zmazať recept?', 'Tento krok sa nedá vrátiť späť.', [
      { text: 'Zrušiť', style: 'cancel' },
      {
        text: 'Zmazať',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteUserRecipe(uid, recipeId);
            navigation.popToTop();
          } catch (e) {
            Alert.alert('Chyba', e?.message || 'Zmazanie zlyhalo.');
          }
        },
      },
    ]);
  }, [uid, recipeId, navigation]);

  // Lacnejšie alternatívy pre jednotlivé suroviny v recepte (`{ name, note, saveEur, store }`).
  // Sekcia v UI nižšie očakáva tento tvar – preto sem nesmieme zapisovať iné dáta.
  useEffect(() => {
    if (!recipe?.ingredients?.length) {
      setCheaperAlternatives([]);
      return;
    }
    let cancelled = false;
    findCheaperAlternativesForRecipe(recipe.ingredients, profile?.preferredStore, uid)
      .then((alts) => {
        if (!cancelled) setCheaperAlternatives(alts);
      })
      .catch(() => {
        if (!cancelled) setCheaperAlternatives([]);
      });
    return () => { cancelled = true; };
  }, [recipe?.id, recipe?.ingredients, profile?.preferredStore, uid]);

  const baseServings = Math.max(1, recipe?.servings ?? 1);
  const factor = servings / baseServings;

  const openAddToPlanModal = () => {
    // Začni s jedným preselectovaným dňom (dnes/prvý) – používateľ vie ďalšie ľahko zaškrtnúť.
    const initial = {};
    weekDates.forEach((d, i) => {
      initial[d] = i === 0;
    });
    setPlanDates(initial);
    setPlanMealType('dinner');
    setShowAddToPlanModal(true);
  };

  const togglePlanDate = (dateStr) => {
    setPlanDates((prev) => ({ ...prev, [dateStr]: !prev[dateStr] }));
  };

  const handleConfirmAddToPlan = async () => {
    if (!uid || !recipeId) return;
    const datesToAdd = weekDates.filter((d) => planDates[d]);
    if (datesToAdd.length === 0) {
      Alert.alert('Vyber aspoň jeden deň', 'Označ jeden alebo viac dní, do ktorých chceš recept pridať.');
      return;
    }
    setAdding('plan');
    try {
      // Posielame `servings` z aktuálneho stavu obrazovky – používateľ si na detaile
      // mohol zvoliť, koľko porcií reálne plánuje uvariť (default = recipe.servings).
      const portions = Math.max(1, Number(servings) || 1);
      // Pridanie cez všetky dni paralelne v rámci toho istého týždňa by mohlo skolidovať
      // pri merge updatoch (race), takže ich spracujeme sekvenčne.
      for (const dateStr of datesToAdd) {
        const ww = getWeekId(new Date(`${dateStr}T00:00:00`));
        await addRecipeToPlan(uid, ww, dateStr, recipeId, planMealType, portions);
      }
      setShowAddToPlanModal(false);
    } catch (err) {
      Alert.alert('Chyba', err?.message || 'Recept sa nepodarilo pridať do plánu.');
    } finally {
      setAdding(null);
    }
  };

  const addToListWithScope = async (scope) => {
    if (!uid || !recipe) return;
    const isHousehold = scope === 'household';
    if (isHousehold && !householdId) {
      Alert.alert('Domácnosť', 'Najprv nastav aktívnu domácnosť.');
      return;
    }
    setAdding('list');
    const seen = new Set();
    const rawItems = (recipe.ingredients ?? [])
      .filter((i) => {
        const key = `${(i.name || '').trim().toLowerCase()}|${(i.unit || '').trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const items = rawItems
      .map((i) => {
        const li = lineItems.find(
          (l) => l.name === i.name || l.nameNormalized === (i.name || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_')
        );
        if (li) {
          const fullNeeded = li.neededQty;
          if (fullNeeded <= 0) return null;
          return {
            name: i.name,
            qty: Math.round(fullNeeded * 100) / 100,
            unit: li.unitBase || 'ks',
          };
        }
        // Fallback: nemáme lineItem (napr. cena sa nepodarila načítať) → posielame pôvodnú jednotku z receptu
        const fullQty = (i.qty ?? 1) * factor;
        if (fullQty <= 0) return null;
        return {
          name: i.name,
          qty: Math.round(fullQty * 100) / 100,
          unit: i.unit ?? 'ks',
        };
      })
      .filter(Boolean);

    if (items.length === 0) {
      Alert.alert('Prázdny recept', 'Recept neobsahuje žiadne ingrediencie s množstvom.');
      setAdding(null);
      return;
    }

    try {
      const ctx = isHousehold
        ? buildHouseholdShoppingContext(householdId)
        : buildUserShoppingContext(uid);
      if (!ctx) throw new Error('shopping context required');

      const allLists = await getShoppingLists(ctx, true);
      const activeLists = allLists.filter((l) => l.status !== 'completed');
      const toMs = (v) =>
        v?.updatedAt && typeof v.updatedAt.toMillis === 'function'
          ? v.updatedAt.toMillis()
          : typeof v?.updatedAt === 'number'
            ? v.updatedAt
            : 0;
      const current = [...activeLists].sort((a, b) => toMs(b) - toMs(a))[0];
      let listId = current?.id;
      if (!listId) listId = await createShoppingList(ctx, { items: [] });
      await addItemsToList(ctx, listId, items);
      setShowAddToListModal(false);
      navigation.navigate('List', {
        initialScope: isHousehold ? 'household' : 'personal',
        _ts: Date.now(),
      });
    } catch (err) {
      Alert.alert('Chyba', err?.message || 'Položky sa nepodarilo pridať do zoznamu.');
    } finally {
      setAdding(null);
    }
  };

  const handleAddToList = async () => {
    if (!householdId) {
      await addToListWithScope('personal');
      return;
    }
    setShowAddToListModal(true);
  };

  const handleUsePantry = async () => {
    if (!uid || !recipe) return;
    setAdding('pantry');
    const seen = new Set();
    const items = (recipe.ingredients ?? [])
      .filter((i) => {
        const key = `${(i.name || '').trim().toLowerCase()}|${(i.unit || '').trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((i) => ({
        name: i.name,
        qty: (i.qty ?? 1) * factor,
        unit: i.unit ?? 'ks',
      }));
    try {
      for (const item of items) {
        await addPantryItem(item);
      }
    } finally {
      setAdding(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Načítavam recept…</Text>
      </View>
    );
  }
  if (error || !recipe) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Recept sa nenašiel</Text>
        <Text style={styles.loadingText}>{error || 'Tento recept neexistuje alebo bol odstránený.'}</Text>
      </View>
    );
  }

  // Odstrániť duplicity (názov + jednotka) – recepty s časťami môžu mať rovnakú surovinu viackrát
  const rawIngredients = (recipe.ingredients ?? []).map((i) => {
    const isPodlaChuti = (i.unit || '').toLowerCase() === 'podľa chuti';
    return {
      ...i,
      qty: isPodlaChuti ? null : ((i.qty ?? 1) * factor),
      unit: i.unit ?? 'ks',
    };
  });
  const seen = new Set();
  const ingredients = rawIngredients.filter((i) => {
    const key = `${(i.name || '').trim().toLowerCase()}|${(i.unit || '').trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const steps = (recipe.steps ?? []).map((s) => (typeof s === 'string' ? s : (s?.text != null ? String(s.text) : String(s ?? ''))));

  return (
    <View style={styles.screenRoot}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, uid ? { paddingBottom: 168 } : {}]}
      showsVerticalScrollIndicator={false}
    >
      {/* fotka a názov */}
      <View style={styles.hero}>
        {recipe.imageUrl && !imageFailed ? (
          <Image
            source={{ uri: recipe.imageUrl }}
            style={styles.heroImage}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.heroImage, styles.heroPlaceholder]}>
            <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.heroOverlay} pointerEvents="none" />
        <TouchableOpacity
          style={styles.heroFavoriteBtn}
          onPress={toggleFavorite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? 'Odstrániť z obľúbených' : 'Pridať do obľúbených'}
          activeOpacity={0.85}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={26}
            color={colors.primary}
          />
        </TouchableOpacity>
        <View style={styles.heroContent} pointerEvents="none">
          <Text style={styles.heroTitle} numberOfLines={3}>{recipe.name}</Text>
          {Array.isArray(recipe.categories) && recipe.categories.length > 0 ? (
            <View style={styles.heroCatRow}>
              {recipe.categories.slice(0, 2).map((c) => (
                <View key={c} style={styles.heroCatChip}>
                  <Text style={styles.heroCatChipText}>{c}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {uid && recipe.authorUid === uid ? (
        <View style={styles.ownerBar}>
          <TouchableOpacity
            style={styles.ownerBarBtn}
            onPress={() => navigation.navigate('EditRecipe', { recipeId })}
            activeOpacity={0.75}
          >
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <Text style={styles.ownerBarBtnText}>Upraviť recept</Text>
          </TouchableOpacity>
          <View style={styles.ownerBarSep} />
          <TouchableOpacity style={styles.ownerBarBtn} onPress={handleDeleteRecipe} activeOpacity={0.75}>
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            <Text style={[styles.ownerBarBtnText, { color: colors.textMuted }]}>Zmazať</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.statBar}>
        <View style={styles.statBox}>
          <Ionicons name="time-outline" size={20} color={colors.primary} />
          <Text style={styles.statValue}>
            {recipe.durationMin != null ? `${recipe.durationMin}` : '–'}
            {recipe.durationMin != null ? <Text style={styles.statUnit}> min</Text> : null}
          </Text>
          <Text style={styles.statLabel}>čas</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Ionicons name="people-outline" size={20} color={colors.primary} />
          <Text style={styles.statValue}>
            {recipe.servings != null && recipe.servings > 0 ? recipe.servings : servings}
          </Text>
          <Text style={styles.statLabel}>porcie</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Ionicons name="cash-outline" size={20} color={colors.primary} />
          {priceLoading ? (
            <Text style={[styles.statValue, styles.statValueMuted]}>…</Text>
          ) : perServing != null ? (
            <Text style={styles.statValue}>
              ~{perServing.toFixed(2)}
              <Text style={styles.statUnit}> €</Text>
            </Text>
          ) : (
            <Text style={[styles.statValue, styles.statValueMuted]}>–</Text>
          )}
          <Text style={styles.statLabel}>na porciu</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <View style={styles.sectionIconCircle}>
              <Ionicons name="people" size={16} color={colors.primary} />
            </View>
            <Text style={styles.sectionTitle}>Počet porcií</Text>
          </View>
          <Text style={styles.sectionSubtitle}>auto-prepočet</Text>
        </View>
        <View style={styles.servingsRow}>
          <TouchableOpacity
            style={[styles.servingsBtn, servings <= 1 && styles.servingsBtnDisabled]}
            onPress={() => setServings((s) => Math.max(1, s - 1))}
            disabled={servings <= 1}
            activeOpacity={0.85}
          >
            <Ionicons name="remove" size={20} color={servings <= 1 ? colors.textMuted : '#FFFFFF'} />
          </TouchableOpacity>
          <View style={styles.servingsValueWrap}>
            <Text style={styles.servingsValue}>{servings}</Text>
            <Text style={styles.servingsValueLabel}>{servings === 1 ? 'porcia' : 'porcie'}</Text>
          </View>
          <TouchableOpacity
            style={styles.servingsBtn}
            onPress={() => setServings((s) => s + 1)}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* suroviny a ceny */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <View style={styles.sectionIconCircle}>
              <Ionicons name="basket-outline" size={16} color={colors.primary} />
            </View>
            <Text style={styles.sectionTitle}>Zloženie</Text>
          </View>
          {lineItems.length > 0 && (() => {
            const fullyInPantryCount = lineItems.filter((li) => li.neededQty > 0 && li.toBuyQty <= 0).length;
            return fullyInPantryCount > 0 ? (
              <View style={styles.pantryHintBadge}>
                <Ionicons name="checkmark-circle" size={12} color={colors.success || colors.primary} />
                <Text style={styles.pantryHintText}>
                  {fullyInPantryCount}/{lineItems.length} máš doma
                </Text>
              </View>
            ) : null;
          })()}
        </View>
        <View style={styles.ingredientsCard}>
        {lineItems.length === 0 ? (
          <Text style={styles.emptyText}>Žiadne zloženie.</Text>
        ) : (
          <>
            {lineItems.map((li, idx) => {
              const fmt = (n) => (n === parseInt(n, 10) ? `${n}` : n.toFixed(1).replace(/\.0$/, ''));
              const qtyDisplay = li.neededQty > 0 ? `${fmt(li.neededQty)} ${li.unitBase}` : 'podľa chuti';
              const fullyInPantry = li.neededQty > 0 && li.toBuyQty <= 0;
              const partiallyInPantry = li.fromPantryQty > 0 && li.toBuyQty > 0;
              return (
                <View key={idx} style={styles.ingredientRow}>
                  <View style={styles.ingredientLeft}>
                    {fullyInPantry ? (
                      <View style={styles.ingredientBadgePantry}>
                        <Text style={styles.ingredientBadgeText}>V špajzi</Text>
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ingredientName}>{li.name}</Text>
                      {partiallyInPantry && (
                        <Text style={styles.ingredientSubtext}>
                          v špajzi: {fmt(li.fromPantryQty)} {li.unitBase} · treba: {fmt(li.toBuyQty)} {li.unitBase}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.ingredientRight}>
                    <Text style={styles.ingredientQty}>{qtyDisplay}</Text>
                    {li.estEur != null && li.estEur > 0 ? (
                      <Text style={styles.ingredientPrice}>
                        ~{li.estEur < 0.005 ? '< 0.01' : li.estEur.toFixed(2)} €
                      </Text>
                    ) : priceLoading ? (
                      <Text style={styles.skeletonText}>–––</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {total != null && (
              <View style={styles.ingredientTotalRow}>
                <Text style={styles.ingredientTotalLabel}>Spolu:</Text>
                <Text style={styles.ingredientTotalValue}>{total.toFixed(2)} €</Text>
              </View>
            )}
            {perServing != null && (
              <View style={styles.ingredientTotalRow}>
                <Text style={styles.ingredientTotalLabel}>Na porciu:</Text>
                <Text style={styles.ingredientTotalValue}>{perServing.toFixed(2)} €</Text>
              </View>
            )}
          </>
        )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <View style={styles.sectionIconCircle}>
              <Ionicons name="list-outline" size={16} color={colors.primary} />
            </View>
            <Text style={styles.sectionTitle}>Postup</Text>
          </View>
          {steps.length > 0 ? (
            <Text style={styles.sectionSubtitle}>{steps.length} {steps.length === 1 ? 'krok' : steps.length < 5 ? 'kroky' : 'krokov'}</Text>
          ) : null}
        </View>
        {steps.length === 0 ? (
          <Text style={styles.emptyText}>Žiadny postup.</Text>
        ) : (
          steps.map((step, idx) => (
            <View key={idx} style={styles.stepRow}>
              <View style={styles.stepNumCircle}>
                <Text style={styles.stepNumText}>{idx + 1}</Text>
              </View>
              <Text style={styles.stepText}>{typeof step === 'string' ? step : String(step ?? '')}</Text>
            </View>
          ))
        )}
      </View>

      {cheaperAlternatives.length > 0 && (
        <View style={[styles.section, styles.altSection]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={styles.cheaperIconWrap}>
                <Ionicons name="trending-down-outline" size={16} color={colors.warning} />
              </View>
              <Text style={styles.sectionTitle}>Lacnejšie alternatívy</Text>
            </View>
          </View>
          {cheaperAlternatives.map((alt, idx) => (
            <View key={idx} style={styles.altRow}>
              <View style={styles.altLeft}>
                <Text style={styles.altName}>{alt.name}</Text>
                <Text style={styles.altNote}>{alt.note}</Text>
              </View>
              <View style={styles.altRight}>
                <Text style={styles.altSave}>−{alt.saveEur.toFixed(2)} €</Text>
                {alt.store && <Text style={styles.altStore}>{alt.store}</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>

      {uid ? (
        <View
          style={[
            styles.recipeFabCluster,
            {
              bottom: spacing.xs,
              left: spacing.lg + insets.left,
              right: spacing.lg + insets.right,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.actionPrimary, styles.actionPrimaryFab]}
            onPress={openAddToPlanModal}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Pridať do týždenného plánu"
          >
            <Ionicons name="calendar" size={20} color="#FFFFFF" />
            <Text style={styles.actionPrimaryText}>Pridať do týždenného plánu</Text>
          </TouchableOpacity>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={handleAddToList}
              disabled={adding === 'list'}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Pridať do nákupného zoznamu"
            >
              {adding === 'list' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="cart-outline" size={18} color={colors.primary} />
              )}
              <Text style={styles.actionSecondaryText} numberOfLines={1}>
                Do zoznamu
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={handleUsePantry}
              disabled={adding === 'pantry'}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Pridať suroviny do špajze"
            >
              {adding === 'pantry' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="archive-outline" size={18} color={colors.primary} />
              )}
              <Text style={styles.actionSecondaryText} numberOfLines={1}>
                Do špajze
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <Modal visible={showAddToPlanModal} transparent animationType="slide" onRequestClose={() => setShowAddToPlanModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowAddToPlanModal(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.sectionHeaderLeft}>
                <View style={styles.sectionIconCircle}>
                  <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Pridať do plánu</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAddToPlanModal(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Vyber dni a typ jedla. Recept sa pridá s {servings}{' '}
              {servings === 1 ? 'porciou' : 'porciami'}.
            </Text>

            <Text style={styles.modalSectionLabel}>Dni</Text>
            <View style={styles.planDayRow}>
              {weekDates.map((dateStr) => {
                const active = !!planDates[dateStr];
                return (
                  <TouchableOpacity
                    key={dateStr}
                    style={[styles.planDayChip, active && styles.planDayChipActive]}
                    onPress={() => togglePlanDate(dateStr)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.planDayChipText,
                        active && styles.planDayChipTextActive,
                      ]}
                    >
                      {shortDay(dateStr)}
                    </Text>
                    <Text
                      style={[
                        styles.planDayChipDate,
                        active && styles.planDayChipTextActive,
                      ]}
                    >
                      {dateStr.slice(8, 10)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.modalSectionLabel}>Typ jedla</Text>
            <View style={styles.planMealRow}>
              {['breakfast', 'lunch', 'dinner'].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.planMealChip, planMealType === type && styles.planMealChipActive]}
                  onPress={() => setPlanMealType(type)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.planMealChipText,
                      planMealType === type && styles.planMealChipTextActive,
                    ]}
                  >
                    {MEAL_LABELS[type]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddToPlanModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Zrušiť</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, adding === 'plan' && { opacity: 0.7 }]}
                onPress={handleConfirmAddToPlan}
                disabled={adding === 'plan'}
                activeOpacity={0.85}
              >
                {adding === 'plan' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.modalConfirmText}>Pridať</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={showAddToListModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddToListModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowAddToListModal(false)}>
          <Pressable style={styles.scopeModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.sectionHeaderLeft}>
                <View style={styles.sectionIconCircle}>
                  <Ionicons name="cart-outline" size={16} color={colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Pridať do zoznamu</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAddToListModal(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Vyber, kam chceš pridať ingrediencie z receptu.</Text>
            <TouchableOpacity
              style={styles.scopeOptionBtn}
              onPress={() => addToListWithScope('personal')}
              disabled={adding === 'list'}
              activeOpacity={0.85}
            >
              <Ionicons name="person-outline" size={18} color={colors.primary} />
              <Text style={styles.scopeOptionText}>Osobný zoznam</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.scopeOptionBtn}
              onPress={() => addToListWithScope('household')}
              disabled={adding === 'list'}
              activeOpacity={0.85}
            >
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={styles.scopeOptionText}>Zdieľaný zoznam domácnosti</Text>
            </TouchableOpacity>
            {adding === 'list' ? (
              <View style={styles.scopeLoadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.scopeLoadingText}>Pridávam ingrediencie…</Text>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createRecipeDetailStyles(colors) {
  return StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: colors.backgroundSecondary },
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: 0, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  loadingText: { ...typography.body, color: colors.textMuted, marginTop: spacing.md },
  errorTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },

  hero: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: colors.cardBlue,
    position: 'relative',
    marginBottom: spacing.md,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroContent: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 32,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroCatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  heroCatChip: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  heroCatChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  heroFavoriteBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.favoriteButtonBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    ...shadows.small,
  },
  ownerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    ...shadows.small,
  },
  ownerBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  ownerBarSep: { width: 1, height: 22, backgroundColor: colors.borderDefault },
  ownerBarBtnText: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.primary },

  statBar: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.small,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueMuted: { color: colors.textMuted },
  statUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  statLabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.borderDefault,
    marginVertical: spacing.xs,
  },

  section: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.small,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tintIndigoSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cheaperIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tintWarningSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionSubtitle: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },

  pantryHintBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.tintSuccessSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pantryHintText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success || '#10B981',
  },

  servingsValueWrap: {
    alignItems: 'center',
    minWidth: 80,
  },
  servingsValueLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  servingsBtnDisabled: { backgroundColor: colors.surfaceMuted },

  stepNumCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tintIndigoSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },

  altSection: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },

  actionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.medium,
    marginBottom: spacing.sm,
    ...shadows.small,
  },
  actionPrimaryFab: {
    marginBottom: 0,
    backgroundColor: 'rgba(255, 107, 157, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.38)',
    shadowColor: '#FF6B9D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  recipeFabCluster: {
    position: 'absolute',
    flexDirection: 'column',
    gap: spacing.sm,
    backgroundColor: colors.fabClusterBackground,
    borderRadius: radius.large,
    padding: spacing.md,
    zIndex: 30,
    elevation: 12,
    borderWidth: 1,
    borderColor: colors.fabClusterBorder,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  actionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.actionSecondaryBg,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.medium,
    borderWidth: 1.5,
    borderColor: colors.actionSecondaryBorder,
  },
  actionSecondaryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  servingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  servingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.small,
  },
  servingsValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
  },
  ingredientsCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.medium,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  ingredientLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  ingredientRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ingredientBadgePantry: {
    backgroundColor: colors.success || '#10B981',
    borderRadius: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    marginRight: spacing.sm,
  },
  ingredientBadgeText: {
    ...typography.caption,
    color: '#FFF',
    fontSize: 9,
    fontWeight: '600',
  },
  ingredientDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },
  ingredientName: { ...typography.body, color: colors.textPrimary },
  ingredientSubtext: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  ingredientQty: { ...typography.body, color: colors.textMuted, fontSize: 13 },
  ingredientPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  ingredientTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ingredientTotalLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  ingredientTotalValue: { ...typography.h4, color: colors.textPrimary, fontWeight: '700' },
  skeletonText: { ...typography.body, color: colors.textMuted, opacity: 0.3 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.backgroundPrimary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderDefault,
    marginBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderDefault,
    marginBottom: spacing.md,
  },
  modalTitle: {
    ...typography.title,
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalSubtitle: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  modalSectionLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  planDayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  planDayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.medium,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 44,
    alignItems: 'center',
  },
  planDayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  planDayChipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  planDayChipDate: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  planDayChipTextActive: { color: '#FFF' },
  planMealRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  planMealChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  planMealChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  planMealChipText: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
  planMealChipTextActive: { color: '#FFF', fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  scopeModalContent: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    ...shadows.medium,
  },
  scopeOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  scopeOptionText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  scopeLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  scopeLoadingText: { ...typography.caption, color: colors.textMuted },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
  },
  modalCancelText: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalConfirmBtn: {
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
  modalConfirmText: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  stepText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 22,
    paddingTop: 4,
  },
  emptyText: { ...typography.body, color: colors.textMuted },
  altRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  altLeft: {
    flex: 1,
    marginRight: spacing.md,
  },
  altRight: {
    alignItems: 'flex-end',
  },
  altName: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  altNote: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  altSave: {
    ...typography.body,
    color: colors.warning,
    fontWeight: '700',
    fontSize: 14,
  },
  altStore: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  altPrice: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
}
