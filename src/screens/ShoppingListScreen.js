// Nákupný zoznam: položky z plánu, odhad ceny, dokončenie nákupu.
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Switch,
  Alert,
  RefreshControl,
  TextInput,
  Platform,
  useWindowDimensions,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import { useShoppingList } from '../hooks/useShoppingList';
import { usePantry } from '../hooks/usePantry';
import { toNameNormKey, fuzzyMatchPantry } from '../utils/ingredientNorm';
import { calcListCost } from '../services/shopping/calcList';
import { aggregateShoppingListItemsForCost } from '../services/shopping/aggregateListItemsForCost';
import { normalizeName } from '../services/pricing/normalize';
import { createPurchaseOrder, getWeekKey, getPurchaseHistoryBetween } from '../services/firestore/purchases';
import { addCompletedPurchaseSnapshot } from '../services/firestore/shoppingLists';
import { getBudgetCycleRange } from '../utils/budgetCycle';
import { listHouseholdsForUser } from '../services/firestore/households';
import { addPantryItems, buildPantryContext } from '../services/firestore/pantry';

const MANUAL_UNIT_OPTIONS = [
  { value: 'ks', label: 'ks' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l' },
];

// Nájde v outpute calcListCost kostovú položku zodpovedajúcu zobrazenej položke zoznamu.
// Používa rovnakú normalizáciu (`normalizeName`) ako kalkulácia — preto je párovanie deterministické.

function findCostItem(item, costItems) {
  if (!item || !Array.isArray(costItems) || costItems.length === 0) return null;
  const key = normalizeName(item.name || '').replace(/\s+/g, '_');
  return costItems.find((li) => li.nameNorm === key) || null;
}

// Záložné párovanie položky zoznamu so špajzou (len keď ešte nemáme cenovú kalkuláciu —
// napr. počas načítavania). Akceptujeme exact alebo vysokú Levenshtein podobnosť (bez `includes`).

function itemMatchesPantryFallback(itemName, pantryNameNormKeys) {
  if (!itemName || !pantryNameNormKeys || pantryNameNormKeys.size === 0) return false;
  const key = toNameNormKey(itemName);
  if (pantryNameNormKeys.has(key)) return true;
  const nameNorm = key.replace(/_/g, ' ');
  const fuzzy = fuzzyMatchPantry(nameNorm, pantryNameNormKeys);
  return fuzzy != null;
}

export default function ShoppingListScreen() {
  const route = useRoute();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createShoppingListStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const requestedScope = route?.params?.initialScope;
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile, updateProfile } = useProfile(uid);
  // Domácnosti, kde je používateľ členom – prepínač sa zobrazí, keď aspoň jedna existuje.

  const [userHouseholds, setUserHouseholds] = useState([]);
  // Osobný zoznam vs. zdieľaný – prepínač priamo na obrazovke (nie len cez profil).

  const [listScope, setListScope] = useState(
    requestedScope === 'household' || requestedScope === 'personal' ? requestedScope : 'personal'
  );
  const [householdsResolved, setHouseholdsResolved] = useState(false);

  const primaryHouseholdId = useMemo(() => {
    if (!userHouseholds.length) return null;
    const active = profile?.activeHouseholdId;
    if (active && userHouseholds.some((h) => h.id === active)) return active;
    return userHouseholds[0]?.id ?? null;
  }, [userHouseholds, profile?.activeHouseholdId]);

  const effectiveHouseholdId =
    listScope === 'household' && primaryHouseholdId ? primaryHouseholdId : null;
  const {
    activeList,
    loading,
    refetch,
    createList,
    updateItems,
    addItem,
    toggleChecked,
    removeItem,
    completeList,
    shoppingCtx,
  } = useShoppingList(uid, { householdId: effectiveHouseholdId });
  const { items: pantryItems, refetch: refetchPantry } = usePantry(uid, {
    householdId: effectiveHouseholdId,
  });

  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [roundToPackage, setRoundToPackage] = useState(false);
  const [listCostData, setListCostData] = useState(null);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [costRefreshKey, setCostRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [manualIngredientName, setManualIngredientName] = useState('');
  const [manualIngredientQty, setManualIngredientQty] = useState('1');
  const [manualIngredientUnit, setManualIngredientUnit] = useState('ks');
  const [manualIngredientBusy, setManualIngredientBusy] = useState(false);
  // null | 'inPantry' | 'toBuy' – celoobrazovkový náhľad danej sekcie

  const [expandedListSection, setExpandedListSection] = useState(null);
  // Inline rozbalenie sekcie „Čo už mám“ (šetri miesto; celá obrazovka = ikona vpravo).

  const [inPantrySectionExpanded, setInPantrySectionExpanded] = useState(false);
  // Plávajúce pridanie suroviny (modal)

  const [addItemModalVisible, setAddItemModalVisible] = useState(false);
  // Úprava množstva položky zoznamu

  const [qtyEditItem, setQtyEditItem] = useState(null);
  const [qtyEditValue, setQtyEditValue] = useState('');
  const [qtyEditUnit, setQtyEditUnit] = useState('ks');
  const [qtyEditSaving, setQtyEditSaving] = useState(false);

  useEffect(() => {
    if (!activeList?.id) {
      setExpandedListSection(null);
      return;
    }
    setInPantrySectionExpanded(false);
  }, [activeList?.id]);

  // Manuálny refresh: znovu načíta zoznam aj špajzu zo servera (bez cache) a prepočíta odhad.
// Používa sa pre pull-to-refresh aj pre explicitné tlačidlo „Obnoviť".

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(true), refetchPantry()]);
      setCostRefreshKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchPantry]);

  useFocusEffect(
    useCallback(() => {
      refetch(false);
      refetchPantry();
      setCostRefreshKey((k) => k + 1);
    }, [refetch, refetchPantry])
  );

  useFocusEffect(
    useCallback(() => {
      if (!uid) {
        setUserHouseholds([]);
        setHouseholdsResolved(true);
        return;
      }
      setHouseholdsResolved(false);
      listHouseholdsForUser(uid)
        .then(setUserHouseholds)
        .catch(() => setUserHouseholds([]))
        .finally(() => setHouseholdsResolved(true));
    }, [uid])
  );

  useEffect(() => {
    if (requestedScope !== 'personal' && requestedScope !== 'household') return;
    if (requestedScope === 'household' && !primaryHouseholdId) return;
    setListScope(requestedScope);
  }, [requestedScope, primaryHouseholdId]);

  const waitingForRequestedHousehold =
    requestedScope === 'household' && !householdsResolved;

  const pantryNameNormKeys = useMemo(
    () => new Set((pantryItems || []).map((p) => toNameNormKey(p.name)).filter(Boolean)),
    [pantryItems]
  );


  const isItemFullyInPantry = useCallback(
    (item) => {
      const costItem = findCostItem(item, listCostData?.items);
      if (costItem) {
        const inPantry = (costItem.fromPantry || 0) > 0;
        const nothingToBuy = (costItem.toBuy || 0) <= 0;
        return inPantry && nothingToBuy;
      }
      return itemMatchesPantryFallback(item.name, pantryNameNormKeys);
    },
    [listCostData?.items, pantryNameNormKeys]
  );

  const stableIdOf = useCallback((item, raw) => {
    const stableIdx = raw.indexOf(item);
    return item.id ?? (stableIdx >= 0 ? `i-${stableIdx}` : 'i-0');
  }, []);

  const closeQtyModal = useCallback(() => {
    setQtyEditItem(null);
    setQtyEditValue('');
    setQtyEditUnit('ks');
  }, []);

  const openQtyModal = useCallback((item) => {
    if (!activeList?.id) return;
    setQtyEditItem(item);
    setQtyEditValue(String(item.qty ?? 1));
    setQtyEditUnit((item.unit || 'ks').trim() || 'ks');
  }, [activeList?.id]);

  const saveQtyModal = useCallback(async () => {
    if (!activeList?.id || !qtyEditItem) return;
    const raw = activeList.items || [];
    const targetId = stableIdOf(qtyEditItem, raw);
    const rawNum = String(qtyEditValue ?? '')
      .trim()
      .replace(/\s/g, '')
      .replace(',', '.');
    let qty = parseFloat(rawNum);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert('Množstvo', 'Zadaj platné kladné číslo.');
      return;
    }
    qty = Math.round(qty * 10000) / 10000;
    const unit = (qtyEditUnit || 'ks').trim() || 'ks';
    setQtyEditSaving(true);
    try {
      const next = raw.map((it) => {
        if (stableIdOf(it, raw) !== targetId) return it;
        return { ...it, qty, unit, checked: false };
      });
      await updateItems(activeList.id, next);
      closeQtyModal();
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa uložiť.');
    } finally {
      setQtyEditSaving(false);
    }
  }, [
    activeList?.id,
    activeList?.items,
    qtyEditItem,
    qtyEditValue,
    qtyEditUnit,
    updateItems,
    closeQtyModal,
    stableIdOf,
  ]);

  const bumpItemToBuyList = useCallback(
    async (item) => {
      if (!activeList?.id) return;
      const raw = activeList.items || [];
      const targetId = stableIdOf(item, raw);
      const q0 = Number(item.qty) || 1;
      const newQty = Math.max(q0 + 0.01, Math.round(q0 * 1.25 * 1000) / 1000);
      try {
        const next = raw.map((it) => {
          if (stableIdOf(it, raw) !== targetId) return it;
          return { ...it, qty: newQty, checked: false };
        });
        await updateItems(activeList.id, next);
      } catch (e) {
        Alert.alert('Chyba', e?.message || 'Nepodarilo sa navýšiť množstvo.');
      }
    },
    [activeList?.id, activeList?.items, updateItems, stableIdOf]
  );

  const { itemsInPantry, itemsToBuy } = useMemo(() => {
    const items = activeList?.items ?? [];
    const inPantry = [];
    const toBuy = [];
    items.forEach((item) => {
      if (isItemFullyInPantry(item)) inPantry.push(item);
      else toBuy.push(item);
    });
    return { itemsInPantry: inPantry, itemsToBuy: toBuy };
  }, [activeList?.items, isItemFullyInPantry]);

  // Samostatné okná pre „Čo už mám“ a „Na nákup“ – vnútorný vertikálny scroll.

  const listSectionScrollMaxHeight = useMemo(
    () => Math.min(360, Math.max(190, Math.round(windowHeight * 0.34))),
    [windowHeight]
  );

  useEffect(() => {
    const items = activeList?.items ?? [];
    if (items.length === 0) {
      setListCostData(null);
      setLoadingCosts(false);
      return;
    }

    let cancelled = false;
    setLoadingCosts(true);
    setListCostData(null);

    (async () => {
      try {
        const aggregatedAll = aggregateShoppingListItemsForCost(items, pantryItems);
        const resultAll = await calcListCost(aggregatedAll, profile?.preferredStore, roundToPackage, uid);

        const checkedItems = items.filter((i) => {
          if (!i.checked) return false;
          const ci = findCostItem(i, resultAll.items);
          if (!ci) return true;
          return (ci.toBuy || 0) > 0;
        });
        const aggregatedChecked = aggregateShoppingListItemsForCost(checkedItems, pantryItems);
        const resultChecked =
          aggregatedChecked.length > 0
            ? await calcListCost(aggregatedChecked, profile?.preferredStore, roundToPackage, uid)
            : { estTotalEur: 0, savedByPantry: 0, items: [] };

        if (!cancelled) {
          setListCostData({
            estTotalEur: resultAll.estTotalEur,
            savedByPantry: resultAll.savedByPantry,
            items: resultAll.items,
            checkedEstTotalEur: resultChecked.estTotalEur,
          });
          setLoadingCosts(false);
        }
      } catch (error) {
        if (!cancelled) {
          if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
            console.warn('[ShoppingListScreen] calcListCost failed:', error);
          }
          setListCostData(null);
          setLoadingCosts(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeList?.id, activeList?.items, pantryItems, roundToPackage, profile?.preferredStore, costRefreshKey, uid]);

  const handleCreateList = async () => {
    setCreating(true);
    try {
      await createList();
      await refetch();
    } finally {
      setCreating(false);
    }
  };

  const handleAddManualIngredient = async () => {
    const name = manualIngredientName.trim();
    if (!name || !activeList?.id) return;
    const rawQty = String(manualIngredientQty ?? '')
      .trim()
      .replace(/\s/g, '')
      .replace(',', '.');
    let qty = parseFloat(rawQty);
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    setManualIngredientBusy(true);
    try {
      await addItem(activeList.id, {
        name,
        qty,
        unit: manualIngredientUnit || 'ks',
        checked: false,
      });
      setManualIngredientName('');
      setManualIngredientQty('1');
      setAddItemModalVisible(false);
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa pridať položku.');
    } finally {
      setManualIngredientBusy(false);
    }
  };

  const handleToggle = async (itemId, checked) => {
    if (!activeList?.id) return;
    await toggleChecked(activeList.id, itemId, checked);
  };

  const getCurrentWeekSpent = useCallback(async () => {
    const { cycleStart, nextCycleStart } = getBudgetCycleRange(profile ?? {});
    const budget = typeof profile?.weeklyBudget === 'number' ? profile.weeklyBudget : 50;
    const maxSane = budget * 10;
    const orders = await getPurchaseHistoryBetween(uid, cycleStart, nextCycleStart, 200);
    let weekTotal = 0;
    orders.forEach((order) => {
      const amt = typeof order?.paidTotalEur === 'number'
        ? order.paidTotalEur
        : typeof order?.estTotalEur === 'number'
          ? order.estTotalEur
          : 0;
      if (amt > 0 && amt <= maxSane) weekTotal += amt;
    });
    return Math.round(weekTotal * 100) / 100;
  }, [uid, profile]);

  const handleRemoveItem = useCallback(
    (item) => {
      if (!activeList?.id) return;
      const raw = activeList.items || [];
      const stableIdx = raw.indexOf(item);
      const id = item.id ?? (stableIdx >= 0 ? `i-${stableIdx}` : `i-0`);
      Alert.alert(
        'Odstrániť položku?',
        `Odstrániť „${item.name || 'položka'}" zo zoznamu?`,
        [
          { text: 'Zrušiť', style: 'cancel' },
          {
            text: 'Odstrániť',
            style: 'destructive',
            onPress: () => removeItem(activeList.id, id),
          },
        ]
      );
    },
    [activeList?.id, activeList?.items, removeItem]
  );

  const handleCompleteList = async () => {
    if (!activeList?.id || !uid) return;
    const items = activeList.items || [];
    const boughtLines = items.filter((i) => i.checked && !isItemFullyInPantry(i));
    if (boughtLines.length === 0) {
      Alert.alert(
        'Žiadna položka na účtenke',
        'Odškrtni aspoň jednu položku z nákupného zoznamu, ktorú si skutočne nakúpila. Ostatné môžeš nechať neodškrtnuté — ostanú v zozname.'
      );
      return;
    }

    const aggregated = aggregateShoppingListItemsForCost(boughtLines, pantryItems);
    let costResult;
    try {
      costResult = await calcListCost(aggregated, profile?.preferredStore, roundToPackage, uid);
    } catch (e) {
      Alert.alert('Chyba', 'Nepodarilo sa spočítať sumu za odškrtnuté položky.');
      return;
    }
    const checkedTotal = Math.round((costResult?.estTotalEur ?? 0) * 100) / 100;

    const listId = activeList.id;
    const weeklyBudget = typeof profile?.weeklyBudget === 'number' ? profile.weeklyBudget : 50;

    const spentSoFar = await getCurrentWeekSpent();
    const afterTotal = spentSoFar + checkedTotal;
    const overBy = afterTotal - weeklyBudget;
    if (weeklyBudget > 0 && overBy > 0.01) {
      const ok = await new Promise((resolve) => {
        Alert.alert(
          'Prekročenie rozpočtu',
          `Po tomto nákube budeš mať minútých ${afterTotal.toFixed(2)} € z ${weeklyBudget} € (prekročenie o ${overBy.toFixed(2)} €). Chceš aj tak započítať túto účtenku?`,
          [
            { text: 'Zrušiť', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Áno, započítať', onPress: () => resolve(true) },
          ]
        );
      });
      if (!ok) return;
    }

    const remainingItems = items.filter((i) => !i.checked);
    const nextRemaining = remainingItems.filter((i) => !isItemFullyInPantry(i));
    const clearedPantryOnly = remainingItems.length > 0 && nextRemaining.length === 0;

    setCompleting(true);
    try {
      if (remainingItems.length === 0) {
        await completeList(listId, checkedTotal);
        await updateItems(listId, []);
        await createList();
      } else if (nextRemaining.length === 0) {
        // Zostali len položky už pokryté špajzou (bez nákupu) — po účtenke ich zmažeme a zoznam uzavrieme.
        if (!shoppingCtx) throw new Error('Chýba kontext nákupného zoznamu');
        await addCompletedPurchaseSnapshot(shoppingCtx, {
          items: boughtLines,
          completedTotalEur: checkedTotal,
          label: clearedPantryOnly ? 'Časť nákupu (špajza)' : 'Časť nákupu',
        });
        await updateItems(listId, []);
        await completeList(listId, checkedTotal);
        await createList();
      } else {
        if (!shoppingCtx) throw new Error('Chýba kontext nákupného zoznamu');
        await addCompletedPurchaseSnapshot(shoppingCtx, {
          items: boughtLines,
          completedTotalEur: checkedTotal,
          label: 'Časť nákupu',
        });
        await updateItems(listId, nextRemaining);
      }

      const orderItems = boughtLines.map((item) => {
        const costItem = findCostItem(item, costResult.items);
        return {
          nameNorm: toNameNormKey(item.name),
          qtyBase: item.qty || 1,
          unitBase: (item.unit || 'ks').toLowerCase(),
          estEur: costItem?.estEur ?? null,
        };
      });
      const weekKey = getWeekKey();
      const purchaseOrderPromise = createPurchaseOrder(uid, {
          store: profile?.preferredStore || '',
          items: orderItems,
          estTotalEur: checkedTotal,
          paidTotalEur: checkedTotal,
          planWeekKey: weekKey,
        }).catch((orderErr) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
            console.warn('[ShoppingList] createPurchaseOrder failed:', orderErr);
          }
        });

      // Zápis do purchases + presun do špajze bežia paralelne.
      await Promise.all([
        purchaseOrderPromise,
        addPantryItems(
          buildPantryContext(uid, effectiveHouseholdId),
          boughtLines.map((item) => ({
            name: item.name,
            qty: Number(item.qty) || 1,
            unit: item.unit || 'ks',
          }))
        ).catch(() => {}),
        refetch(true),
      ]);
      refetchPantry();
      Alert.alert(
        'Nákup započítaný',
        remainingItems.length === 0
          ? `Suma ${checkedTotal.toFixed(2)} € bola započítaná do rozpočtu. Zoznam je prázdny.`
          : clearedPantryOnly
            ? `Suma ${checkedTotal.toFixed(2)} € bola započítaná do rozpočtu. Zostávali len položky zo špajzi — tie sme odstránili a zoznam uzavreli.`
            : `Suma ${checkedTotal.toFixed(2)} € bola započítaná do rozpočtu. Neodškrtnuté položky zostali v zozname.`
      );
    } catch (error) {
      Alert.alert('Chyba', error?.message || 'Nákup sa nepodarilo uzavrieť.');
    } finally {
      setCompleting(false);
    }
  };

  if ((loading && !activeList) || waitingForRequestedHousehold) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Načítavam zoznam…</Text>
      </View>
    );
  }

  const items = activeList?.items ?? [];
  const totalCount = items.length;

  const preferredStore = (profile?.preferredStore || '').trim().toUpperCase();

  const renderItemRow = (item, opts = {}) => {
    const { showCheckbox = true, showNudgeToBuy = false } = opts;
    const hidePantryBadge = !showCheckbox;
    const raw = activeList?.items ?? [];
    const id = stableIdOf(item, raw);
    const checked = !!item.checked;
    const costItem = findCostItem(item, listCostData?.items);
    const inPantry = isItemFullyInPantry(item);
    const estEur = costItem?.estEur;
    const showPrice = !inPantry && estEur != null && estEur > 0;
    const priceLabel = showPrice
      ? estEur < 0.005
        ? '< 0.01 €'
        : `${estEur.toFixed(2)} €`
      : null;
    const packages = costItem?.packages;
    const store = costItem?.store;

    let qtyDisplay = '';
    const showPackageHint =
      roundToPackage &&
      packages != null &&
      packages > 0 &&
      costItem?.rounded;
    if (showPackageHint) {
      const origQty = Math.round((item.qty ?? costItem?.qtyBase ?? 0) * 100) / 100;
      const origUnit = costItem?.unitBase ?? item.unit ?? '';
      qtyDisplay = `${packages}× balenie${origQty ? ` (potrebuješ ${origQty} ${origUnit})` : ''}`;
    } else if (costItem) {
      const displayQty = costItem.toBuyQty ?? costItem.qtyBase ?? item.qty;
      const displayUnit = costItem.unitBase ?? item.unit;
      qtyDisplay = displayQty != null ? `${Math.round(displayQty * 100) / 100} ${displayUnit || ''}`.trim() : '';
    } else if (item.qty != null || item.unit) {
      qtyDisplay = [item.qty, item.unit].filter(Boolean).join(' ');
    }

    return (
      <View key={id} style={[styles.itemRow, !showCheckbox && styles.itemRowNoCheckbox]}>
        {showCheckbox ? (
          <TouchableOpacity
            style={styles.checkboxHit}
            onPress={() => handleToggle(id, !checked)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityLabel={checked ? 'Zrušiť odškrtnutie' : 'Označiť ako nakúpené'}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
          >
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
              {checked && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
            </View>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.itemRowMain}
          onPress={() => openQtyModal(item)}
          activeOpacity={0.72}
          accessibilityLabel={`Upraviť množstvo: ${item.name || 'položka'}`}
          accessibilityRole="button"
        >
          <View style={styles.itemContent}>
            <View style={styles.itemNameRow}>
              <Text style={[styles.itemName, checked && showCheckbox && styles.itemNameChecked]} numberOfLines={1}>
                {item.name}
              </Text>
              {inPantry && !hidePantryBadge ? (
                <View style={styles.inPantryBadge}>
                  <Text style={styles.inPantryText}>V špajzi</Text>
                </View>
              ) : null}
              {showPrice && (
                <Text style={styles.itemPrice}>{priceLabel}</Text>
              )}
            </View>
            {!inPantry && store && (
              <Text style={styles.storeRecommendation}>
                V {store}: {costItem?.rounded ? 'zaokrúhlené na balenie' : ''}
              </Text>
            )}
            <Text style={styles.itemMeta}>{qtyDisplay}</Text>
          </View>
        </TouchableOpacity>
        {showNudgeToBuy && uid ? (
          <TouchableOpacity
            style={styles.nudgeToBuyBtn}
            onPress={() => bumpItemToBuyList(item)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Navýšiť množstvo — položka sa presunie medzi Na nákup"
            accessibilityRole="button"
          >
            <Ionicons name="cart-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.removeItemBtn}
          onPress={() => handleRemoveItem(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Odstrániť položku"
        >
          <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.screenRoot}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        activeList ? { paddingBottom: 168 } : {},
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.pageLead}>
        {userHouseholds.length > 0
          ? 'Odhad cien, špajza (pri „Domácnosť“ zdieľaná) a účtenka.'
          : 'Odhad cien, špajza a účtenka.'}
      </Text>

      {userHouseholds.length > 0 ? (
        <View style={styles.scopeToggle}>
          <View style={styles.scopeChips}>
            <TouchableOpacity
              style={[styles.scopeChip, listScope === 'personal' && styles.scopeChipOn]}
              onPress={() => setListScope('personal')}
              activeOpacity={0.85}
            >
              <Ionicons
                name="person-outline"
                size={16}
                color={listScope === 'personal' ? '#FFFFFF' : colors.textMuted}
              />
              <Text style={[styles.scopeChipText, listScope === 'personal' && styles.scopeChipTextOn]}>
                Osobný
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scopeChip, listScope === 'household' && styles.scopeChipOn]}
              onPress={async () => {
                setListScope('household');
                if (primaryHouseholdId && profile?.activeHouseholdId !== primaryHouseholdId) {
                  try {
                    await updateProfile({ activeHouseholdId: primaryHouseholdId });
                  } catch {
                    }
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons
                name="people-outline"
                size={16}
                color={listScope === 'household' ? '#FFFFFF' : colors.textMuted}
              />
              <Text style={[styles.scopeChipText, listScope === 'household' && styles.scopeChipTextOn]}>
                Domácnosť
              </Text>
            </TouchableOpacity>
          </View>
          {listScope === 'household' ? (
            <Text style={styles.scopeHint}>
              {(() => {
                const hn = userHouseholds.find((h) => h.id === primaryHouseholdId)?.name;
                return hn
                  ? `Zdieľaný zoznam a špajza „${hn}“ – úpravy vidia všetci členovia.`
                  : 'Zdieľaný zoznam a špajza – úpravy vidia všetci členovia.';
              })()}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!activeList ? (
        <Card variant="white" paddingSize="large" style={[styles.emptyListCard, shadows.small]}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="cart-outline" size={24} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Žiadny zoznam</Text>
          <Text style={styles.emptyText}>Vytvor prvý nákupný zoznam alebo ho vygeneruj z plánu.</Text>
          <Button
            title={creating ? 'Vytváram…' : 'Vytvoriť zoznam'}
            onPress={handleCreateList}
            variant="primary"
            loading={creating}
            style={styles.createBtn}
          />
        </Card>
      ) : (
        <>
          {/* súhrn: počet položiek, odhad, úspora zo špajzy */}
          <Card variant="white" paddingSize="medium" style={[styles.summaryCardUnified, shadows.small]}>
            <View style={styles.summaryColumns}>
              <View style={styles.summaryColumn}>
                <View style={[styles.summaryAccentDot, { backgroundColor: colors.primary }]} />
                <Text style={styles.summaryValue}>{totalCount}</Text>
                <Text style={styles.summaryLabel}>Položiek</Text>
              </View>
              <View style={styles.summaryColumnDivider} />
              <View style={styles.summaryColumn}>
                <View style={[styles.summaryAccentDot, { backgroundColor: colors.success }]} />
                <Text style={styles.summaryValue}>
                  {loadingCosts ? '–––' : listCostData?.estTotalEur != null ? `${listCostData.estTotalEur.toFixed(2)} €` : '–'}
                </Text>
                <Text style={styles.summaryLabel}>Odhad nákupu</Text>
              </View>
              <View style={styles.summaryColumnDivider} />
              <View style={styles.summaryColumn}>
                <View style={[styles.summaryAccentDot, { backgroundColor: colors.warning }]} />
                <Text style={styles.summaryValue}>
                  {loadingCosts ? '–––' : listCostData?.savedByPantry != null ? `${listCostData.savedByPantry.toFixed(2)} €` : '–'}
                </Text>
                <Text style={styles.summaryLabel}>V špajzi (ušetrené)</Text>
              </View>
            </View>
          </Card>

          {items.some((i) => i.checked && !isItemFullyInPantry(i)) && (
            <Text style={styles.receiptHint}>
              Účtenka (len odškrtnuté):{' '}
              {loadingCosts
                ? '…'
                : listCostData?.checkedEstTotalEur != null
                  ? `${listCostData.checkedEstTotalEur.toFixed(2)} €`
                  : '–'}
            </Text>
          )}

          <View style={styles.roundToPackageRow}>
            <Text style={styles.roundToPackageLabel}>Zaokrúhliť na balenia</Text>
            <Switch
              value={roundToPackage}
              onValueChange={setRoundToPackage}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.backgroundPrimary}
            />
          </View>

          {/* čo už mám doma */}
          {itemsInPantry.length > 0 && (
            <View style={styles.section}>
              <View style={styles.categoryHeaderRowActions}>
                <TouchableOpacity
                  style={[styles.categoryHeaderExpandable, styles.categoryHeaderExpandableFlex]}
                  onPress={() => setInPantrySectionExpanded((v) => !v)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: inPantrySectionExpanded }}
                  accessibilityLabel={
                    inPantrySectionExpanded
                      ? 'Zbaliť sekciu Čo už mám'
                      : 'Rozbaliť sekciu Čo už mám'
                  }
                >
                  <View style={styles.categoryHeaderExpandableLeft}>
                    <View style={styles.categoryIconCircle}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} />
                    </View>
                    <View style={styles.categoryHeaderTitles}>
                      <Text style={styles.categoryLabel}>Čo už mám</Text>
                      <Text style={styles.categoryHeaderHint}>
                        {inPantrySectionExpanded
                          ? 'Ťukni pre zbalenie'
                          : 'Ťukni pre zobrazenie položiek'}{' '}
                        ({itemsInPantry.length})
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={inPantrySectionExpanded ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color={colors.success}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setExpandedListSection('inPantry')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.categoryHeaderFullscreenBtn}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Čo už mám na celú obrazovku"
                >
                  <Ionicons name="expand-outline" size={22} color={colors.success} />
                </TouchableOpacity>
              </View>
              {inPantrySectionExpanded ? (
                <Card variant="white" paddingSize="medium" style={[styles.listCard, styles.listSectionScrollCard, styles.listCardAccentPantry, shadows.small]}>
                  <ScrollView
                    style={[styles.listSectionInnerScroll, { maxHeight: listSectionScrollMaxHeight }]}
                    contentContainerStyle={styles.listSectionInnerScrollContent}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    {itemsInPantry.map((item) => renderItemRow(item, { showCheckbox: false, showNudgeToBuy: true }))}
                  </ScrollView>
                </Card>
              ) : null}
            </View>
          )}

          {/* čo treba kúpiť */}
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.categoryHeaderExpandable, itemsToBuy.length === 0 && styles.categoryHeaderExpandableMuted]}
              onPress={() => itemsToBuy.length > 0 && setExpandedListSection('toBuy')}
              activeOpacity={itemsToBuy.length > 0 ? 0.75 : 1}
              disabled={itemsToBuy.length === 0}
              accessibilityRole="button"
              accessibilityLabel={
                itemsToBuy.length > 0
                  ? 'Zobraziť Na nákup na celú obrazovku'
                  : 'Na nákup — žiadne položky'
              }
            >
              <View style={styles.categoryHeaderExpandableLeft}>
                <View style={styles.categoryIconCircle}>
                  <Ionicons name="cart-outline" size={14} color={colors.primary} />
                </View>
                <View style={styles.categoryHeaderTitles}>
                  <Text style={styles.categoryLabel}>Na nákup</Text>
                  {itemsToBuy.length > 0 ? (
                    <Text style={styles.categoryHeaderHint}>
                      Ťuknutím zobrazíš na celú obrazovku ({itemsToBuy.length})
                    </Text>
                  ) : (
                    <Text style={styles.categoryHeaderHintMuted}>
                      {itemsInPantry.length === 0 && items.length === 0
                        ? 'Zatiaľ nič na nákupe'
                        : 'Všetko máš v špajzi'}
                    </Text>
                  )}
                </View>
              </View>
              {itemsToBuy.length > 0 ? (
                <Ionicons name="expand-outline" size={22} color={colors.primary} />
              ) : null}
            </TouchableOpacity>
            {uid ? (
              <View style={styles.toBuyAddStrip}>
                <Text style={styles.toBuyAddStripLabel}>Pridať položku priamo na nákup</Text>
                <TouchableOpacity
                  style={styles.addListItemFabInline}
                  onPress={() => setAddItemModalVisible(true)}
                  activeOpacity={0.88}
                  accessibilityLabel="Pridať surovinu na nákupný zoznam"
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={28} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ) : null}
            <Card variant="white" paddingSize="medium" style={[styles.listCard, styles.listSectionScrollCard, styles.listCardAccentBuy, shadows.small]}>
              {itemsToBuy.length === 0 && itemsInPantry.length === 0 ? (
                <Text style={styles.emptyText}>Zoznam je prázdny. Pridaj položky z receptu alebo vygeneruj z plánu.</Text>
              ) : itemsToBuy.length === 0 ? (
                <Text style={styles.emptyText}>Všetko ostatné už máš v špajzi.</Text>
              ) : (
                <ScrollView
                  style={[styles.listSectionInnerScroll, { maxHeight: listSectionScrollMaxHeight }]}
                  contentContainerStyle={styles.listSectionInnerScrollContent}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {itemsToBuy.map((item) => renderItemRow(item, { showCheckbox: true, showNudgeToBuy: false }))}
                </ScrollView>
              )}
            </Card>
          </View>

          {(() => {
            const budget = typeof profile?.weeklyBudget === 'number' ? profile.weeklyBudget : 50;
            const hasCheckedToBuy = items.some((i) => {
              if (!i.checked) return false;
              const ci = findCostItem(i, listCostData?.items || []);
              if (!ci) return true;
              return (ci.toBuy || 0) > 0;
            });
            const est =
              hasCheckedToBuy && listCostData?.checkedEstTotalEur != null
                ? listCostData.checkedEstTotalEur
                : listCostData?.estTotalEur;
            if (typeof est === 'number' && budget > 0 && est > budget) {
              return (
                <Text style={styles.budgetWarning}>
                  {hasCheckedToBuy ? 'Účtenka (odškrtnuté)' : 'Odhad nákupu'} ({est.toFixed(2)} €) prekračuje tvoj
                  rozpočet na tento týždeň ({budget} €).
                </Text>
              );
            }
            return null;
          })()}
        </>
      )}
    </ScrollView>

      {activeList ? (
        <View
          style={[
            styles.listFabBar,
            {
              bottom: spacing.sm + 2,
              left: spacing.lg + insets.left,
              right: spacing.lg + insets.right,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.listFabPrimaryFull, completing && { opacity: 0.75 }]}
            onPress={handleCompleteList}
            disabled={completing}
            activeOpacity={0.88}
            accessibilityLabel="Započítať nákup za odškrtnuté položky"
            accessibilityRole="button"
          >
            {completing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.listFabPrimaryText}>Započítať nákup (odškrtnuté)</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.listFabHint} numberOfLines={3}>
            Odškrtnutie a hromadné označenie nájdeš po rozšírení sekcie „Na nákup“ na celú obrazovku. Do rozpočtu sa
            započíta len odškrtnuté položky.
          </Text>
        </View>
      ) : null}

    <Modal
      visible={addItemModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => !manualIngredientBusy && setAddItemModalVisible(false)}
    >
      <KeyboardAvoidingView
        style={styles.qtyModalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.qtyModalBackdrop}
          onPress={() => !manualIngredientBusy && setAddItemModalVisible(false)}
        />
        <View style={styles.qtyModalCenter}>
          <View style={[styles.qtyModalCard, styles.addItemModalCard]}>
            <View style={styles.addItemModalHeaderRow}>
              <Text style={[styles.qtyModalTitle, styles.addItemModalTitle]} numberOfLines={1}>
                Pridať surovinu
              </Text>
              <TouchableOpacity
                onPress={() => !manualIngredientBusy && setAddItemModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Zavrieť"
              >
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.addItemModalHint}>
              Názov, množstvo a jednotka (pre mlieko napr. 1 l alebo 1000 ml – odhad ceny je presnejší ako pri „1 ks“).
            </Text>
            <View style={styles.addIngredientRow}>
              <TextInput
                style={styles.addIngredientInput}
                placeholder="Názov suroviny…"
                placeholderTextColor={colors.textMuted}
                value={manualIngredientName}
                onChangeText={setManualIngredientName}
                onSubmitEditing={handleAddManualIngredient}
                returnKeyType="next"
                editable={!manualIngredientBusy}
              />
              <TouchableOpacity
                style={[
                  styles.addIngredientBtn,
                  (!manualIngredientName.trim() || manualIngredientBusy) && styles.addIngredientBtnDisabled,
                ]}
                onPress={handleAddManualIngredient}
                disabled={!manualIngredientName.trim() || manualIngredientBusy}
                activeOpacity={0.85}
              >
                {manualIngredientBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="add" size={22} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.addIngredientQtyRow}>
              <Text style={styles.addIngredientFieldLabel}>Množstvo</Text>
              <TextInput
                style={styles.addIngredientQtyInput}
                placeholder="1"
                placeholderTextColor={colors.textMuted}
                value={manualIngredientQty}
                onChangeText={setManualIngredientQty}
                keyboardType="decimal-pad"
                editable={!manualIngredientBusy}
              />
            </View>
            <Text style={styles.addIngredientFieldLabel}>Jednotka</Text>
            <View style={styles.unitChipRow}>
              {MANUAL_UNIT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.unitChipPick,
                    manualIngredientUnit === opt.value && styles.unitChipPickOn,
                  ]}
                  onPress={() => setManualIngredientUnit(opt.value)}
                  disabled={manualIngredientBusy}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.unitChipPickText,
                      manualIngredientUnit === opt.value && styles.unitChipPickTextOn,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal
      visible={qtyEditItem != null}
      transparent
      animationType="fade"
      onRequestClose={closeQtyModal}
    >
      <KeyboardAvoidingView
        style={styles.qtyModalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.qtyModalBackdrop} onPress={closeQtyModal} />
        <View style={styles.qtyModalCenter}>
          <View style={styles.qtyModalCard}>
            <Text style={styles.qtyModalTitle}>Množstvo</Text>
            {qtyEditItem ? (
              <Text style={styles.qtyModalSubtitle} numberOfLines={2}>
                {qtyEditItem.name}
              </Text>
            ) : null}
            <TextInput
              style={styles.qtyModalInput}
              value={qtyEditValue}
              onChangeText={setQtyEditValue}
              keyboardType="decimal-pad"
              placeholder="Množstvo"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.qtyModalUnitLabel}>Jednotka</Text>
            <View style={styles.qtyModalUnitRow}>
              {MANUAL_UNIT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.qtyUnitChip, qtyEditUnit === opt.value && styles.qtyUnitChipOn]}
                  onPress={() => setQtyEditUnit(opt.value)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.qtyUnitChipText, qtyEditUnit === opt.value && styles.qtyUnitChipTextOn]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.qtyModalActions}>
              <TouchableOpacity style={styles.qtyModalCancel} onPress={closeQtyModal} activeOpacity={0.75}>
                <Text style={styles.qtyModalCancelText}>Zrušiť</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.qtyModalSave, qtyEditSaving && { opacity: 0.65 }]}
                onPress={saveQtyModal}
                disabled={qtyEditSaving}
                activeOpacity={0.85}
              >
                {qtyEditSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.qtyModalSaveText}>Uložiť</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal
      visible={expandedListSection != null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setExpandedListSection(null)}
    >
      <View
        style={[
          styles.fullListModalRoot,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.fullListModalHeader}>
          <TouchableOpacity
            onPress={() => setExpandedListSection(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Zavrieť"
          >
            <Ionicons name="close" size={28} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.fullListModalTitle} numberOfLines={1}>
            {expandedListSection === 'toBuy' ? 'Na nákup' : 'Čo už mám'}
          </Text>
          <View style={styles.fullListModalHeaderSpacer} />
        </View>
        {expandedListSection === 'toBuy' ? (
          <View style={styles.fullListBulkRow}>
            <TouchableOpacity
              style={[styles.listFabSecondaryFull, styles.fullListBulkMarkAll]}
              onPress={async () => {
                if (!activeList?.id) return;
                const allChecked = items.map((i) =>
                  isItemFullyInPantry(i) ? { ...i, checked: false } : { ...i, checked: true }
                );
                await updateItems(activeList.id, allChecked);
              }}
              activeOpacity={0.85}
              accessibilityLabel="Označiť všetko ako nakúpené"
              accessibilityRole="button"
            >
              <Text style={styles.listFabSecondaryText}>Označiť všetko ako nakúpené</Text>
            </TouchableOpacity>
            {items.some((i) => i.checked && !isItemFullyInPantry(i)) ? (
              <TouchableOpacity
                style={styles.fullListBulkClear}
                onPress={async () => {
                  if (!activeList?.id) return;
                  await updateItems(
                    activeList.id,
                    items.map((it) => ({ ...it, checked: false }))
                  );
                }}
                activeOpacity={0.85}
                accessibilityLabel="Odznačiť výber"
                accessibilityRole="button"
              >
                <Text style={styles.listFabClearText}>Odznačiť výber</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        <ScrollView
          style={styles.fullListModalScroll}
          contentContainerStyle={styles.fullListModalScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {(expandedListSection === 'toBuy' ? itemsToBuy : itemsInPantry).map((item) =>
            renderItemRow(item, {
              showCheckbox: expandedListSection === 'toBuy',
              showNudgeToBuy: false,
            })
          )}
        </ScrollView>
      </View>
    </Modal>
    </View>
  );
}

function createShoppingListStyles(colors) {
  return StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: colors.backgroundSecondary },
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  loadingText: { ...typography.body, color: colors.textMuted, marginTop: spacing.md },
  pageLead: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  scopeToggle: {
    marginBottom: spacing.lg,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadows.small,
  },
  scopeChips: { flexDirection: 'row', gap: spacing.sm },
  scopeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scopeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  scopeChipText: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  scopeChipTextOn: { color: '#FFFFFF' },
  scopeHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontSize: 12 },

  emptyListCard: { marginBottom: spacing.lg },
  summaryCardUnified: { marginBottom: spacing.lg },
  summaryColumns: { flexDirection: 'row', alignItems: 'stretch' },
  summaryColumn: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  summaryColumnDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  summaryAccentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: spacing.sm,
  },
  summaryValue: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  summaryLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  savingsText: { ...typography.caption, color: colors.success, marginBottom: spacing.md, fontWeight: '600' },
  roundToPackageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm,
  },
  roundToPackageLabel: { ...typography.body, color: colors.textPrimary },
  addIngredientCard: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadows.small,
  },
  addIngredientLabel: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  addIngredientHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  addIngredientRow: { flexDirection: 'row', alignItems: 'center' },
  addIngredientInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: 16,
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  addIngredientBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIngredientBtnDisabled: { opacity: 0.45 },
  addIngredientQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  addIngredientFieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    width: 88,
  },
  addIngredientQtyInput: {
    flex: 1,
    maxWidth: 120,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
    fontSize: 16,
    color: colors.textPrimary,
  },
  unitChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  unitChipPick: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: colors.backgroundSecondary,
  },
  unitChipPickOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  unitChipPickText: { ...typography.caption, fontWeight: '600', color: colors.textPrimary },
  unitChipPickTextOn: { color: '#FFFFFF' },
  section: { marginBottom: spacing.lg },
  categoryHeaderRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  categoryHeaderExpandableFlex: {
    flex: 1,
    marginBottom: 0,
    minWidth: 0,
  },
  categoryHeaderFullscreenBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  categoryHeaderExpandable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.xs,
  },
  categoryHeaderExpandableMuted: {
    opacity: 0.9,
  },
  categoryHeaderExpandableLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  categoryHeaderTitles: {
    flex: 1,
    minWidth: 0,
  },
  categoryHeaderHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 11,
  },
  categoryHeaderHintMuted: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 11,
    fontStyle: 'italic',
  },
  fullListModalRoot: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  fullListModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundPrimary,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  fullListModalTitle: {
    ...typography.h4,
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  fullListModalHeaderSpacer: {
    width: 28,
  },
  fullListBulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: colors.backgroundPrimary,
  },
  fullListBulkMarkAll: {
    flex: 1,
    minWidth: 0,
  },
  fullListBulkClear: {
    flexShrink: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  fullListModalScroll: {
    flex: 1,
  },
  fullListModalScrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  categoryIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 107, 157, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  listCard: { marginBottom: 0, overflow: 'hidden' },
  listCardAccentPantry: {
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  listCardAccentBuy: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  listSectionScrollCard: {
    overflow: 'hidden',
  },
  listSectionInnerScroll: {
    flexGrow: 0,
  },
  listSectionInnerScrollContent: {
    paddingBottom: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  itemRowNoCheckbox: {
    paddingLeft: spacing.sm,
  },
  itemRowMain: {
    flex: 1,
    minWidth: 0,
  },
  checkboxHit: {
    width: 36,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeToBuyBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    marginRight: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeItemBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: spacing.xs,
  },
  receiptHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  completeHint: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary },
  itemContent: { flex: 1 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  itemNameChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  itemPrice: { ...typography.body, color: colors.primary, fontWeight: '600' },
  storeRecommendation: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  itemMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  inPantryBadge: {
    backgroundColor: colors.cardGreen,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.small,
  },
  inPantryText: { ...typography.caption, color: colors.success, fontWeight: '600', fontSize: 11 },
  emptyTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 107, 157, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    alignSelf: 'center',
  },
  createBtn: { marginTop: spacing.lg },
  listFabBar: {
    position: 'absolute',
    flexDirection: 'column',
    gap: spacing.xs,
    backgroundColor: colors.fabClusterBackground,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    zIndex: 30,
    elevation: 12,
    borderWidth: 1,
    borderColor: colors.fabClusterBorder,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  listFabSecondaryFull: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.small + 2,
    borderWidth: 1,
    borderColor: colors.actionSecondaryBorder,
    backgroundColor: colors.actionSecondaryBg,
  },
  listFabSecondaryText: { ...typography.body, color: colors.primary, fontWeight: '700', fontSize: 13 },
  listFabPrimaryFull: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.small + 2,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  listFabPrimaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  listFabHint: {
    ...typography.small,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
    paddingHorizontal: spacing.xs,
  },
  budgetWarning: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  qtyModalRoot: { flex: 1 },
  qtyModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  qtyModalCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  qtyModalCard: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadows.medium,
  },
  qtyModalTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.xs },
  qtyModalSubtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  qtyModalInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  qtyModalUnitLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', marginBottom: spacing.xs },
  qtyModalUnitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.lg },
  qtyUnitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: colors.backgroundSecondary,
  },
  qtyUnitChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  qtyUnitChipText: { ...typography.caption, fontWeight: '600', color: colors.textPrimary },
  qtyUnitChipTextOn: { color: '#FFFFFF' },
  qtyModalActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  qtyModalCancel: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  qtyModalCancelText: { ...typography.body, color: colors.textMuted, fontWeight: '600' },
  qtyModalSave: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    minWidth: 120,
    alignItems: 'center',
  },
  qtyModalSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  addListItemFabInline: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 107, 157, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.small,
  },
  toBuyAddStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  toBuyAddStripLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  listFabClearText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  addItemModalCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '88%',
    alignSelf: 'center',
  },
  addItemModalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  addItemModalTitle: {
    flex: 1,
    marginBottom: 0,
    minWidth: 0,
  },
  addItemModalHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
});
}
