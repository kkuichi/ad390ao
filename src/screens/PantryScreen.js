// Špajza: položky doma, odpočítavajú sa pri cenách a nákupnom zozname.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Platform,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import { usePantry } from '../hooks/usePantry';
import {
  seedTestPantry,
  buildUserPantryContext,
  buildPantryContext,
  getPantryItems,
  addPantryItems,
} from '../services/firestore/pantry';
import { listHouseholdsForUser } from '../services/firestore/households';
import { recommendRecipes } from '../services/recommend/recommend';
import { openRecipeDetail } from '../navigation/recipeNavigation';
import { getRecipe } from '../services/firestore/recipes';
import { summarizePantryCoverage } from '../services/pricing/recipeCost';

const UNITS_PANTRY = ['g', 'ml', 'ks'];

// Položky, ktoré expirujú do 7 dní, sa zobrazia v sekcii "Čoskoro expiruje".
const EXPIRY_SOON_DAYS = 7;

function normalizeName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseExpiryDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value?.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatExpiry(date) {
  if (!date) return '';
  return date.toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}

function daysUntil(date) {
  if (!date) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDate - startOfToday) / (24 * 60 * 60 * 1000));
}


export default function PantryScreen() {
  const navigation = useNavigation();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createPantryStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile, updateProfile } = useProfile(uid);
  const [userHouseholds, setUserHouseholds] = useState([]);
  const [pantryScope, setPantryScope] = useState('personal');

  const primaryHouseholdId = useMemo(() => {
    if (!userHouseholds.length) return null;
    const active = profile?.activeHouseholdId;
    if (active && userHouseholds.some((h) => h.id === active)) return active;
    return userHouseholds[0]?.id ?? null;
  }, [userHouseholds, profile?.activeHouseholdId]);

  const effectiveHouseholdId =
    pantryScope === 'household' && primaryHouseholdId ? primaryHouseholdId : null;

  const { items, loading, add, update, remove, refetch, mergeDuplicates } = usePantry(uid, {
    householdId: effectiveHouseholdId,
  });
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const hydratedOnceRef = useRef(false);
  const dedupeRanRef = useRef(false);
  const [leftoverTips, setLeftoverTips] = useState([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('ks');
  // Dátum expirácie sa drží ako Date|null. Do Firestore ide ako ISO string,
  // čo je jednoduchšie ako Timestamp – nepotrebujeme zvláštnu konverziu pri reade.
  const [expiresAt, setExpiresAt] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Inline zoznam položiek (šetri miesto); celá obrazovka = ikona vpravo – ako pri nákupnom zozname.

  const [pantrySectionExpanded, setPantrySectionExpanded] = useState(true);
  const [fullPantryModalVisible, setFullPantryModalVisible] = useState(false);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [personalForImport, setPersonalForImport] = useState([]);
  const [importListLoading, setImportListLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [selectedPersonalIds, setSelectedPersonalIds] = useState(() => new Set());

  const userPantryCtx = useMemo(() => buildUserPantryContext(uid), [uid]);
  const householdPantryCtx = useMemo(
    () => buildPantryContext(uid, effectiveHouseholdId),
    [uid, effectiveHouseholdId]
  );

  const payloadFromPersonalItems = (list) =>
    (list || []).map((p) => ({
      name: String(p?.name || '').trim(),
      qty: Number(p?.qty) || 1,
      unit: p?.unit || 'ks',
      expiresAt: typeof p?.expiresAt === 'string' ? p.expiresAt : null,
    }));

  const openImportFromPersonal = useCallback(async () => {
    if (!uid || !effectiveHouseholdId || !userPantryCtx) return;
    setImportModalVisible(true);
    setSelectedPersonalIds(new Set());
    setImportListLoading(true);
    try {
      const list = await getPantryItems(userPantryCtx);
      setPersonalForImport(list || []);
    } catch {
      setPersonalForImport([]);
    } finally {
      setImportListLoading(false);
    }
  }, [uid, effectiveHouseholdId, userPantryCtx]);

  const togglePersonalImportSelect = useCallback((id) => {
    setSelectedPersonalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllPersonalForImport = useCallback(() => {
    setSelectedPersonalIds(new Set((personalForImport || []).map((p) => p.id)));
  }, [personalForImport]);

  const clearPersonalImportSelection = useCallback(() => {
    setSelectedPersonalIds(new Set());
  }, []);

  const selectedPersonalItems = useMemo(
    () => (personalForImport || []).filter((p) => selectedPersonalIds.has(p.id)),
    [personalForImport, selectedPersonalIds]
  );

  const handleAddSelectedToShared = useCallback(async () => {
    if (!householdPantryCtx || selectedPersonalItems.length === 0) return;
    const n = selectedPersonalItems.length;
    setImportBusy(true);
    try {
      await addPantryItems(householdPantryCtx, payloadFromPersonalItems(selectedPersonalItems));
      await refetch();
      setImportModalVisible(false);
      setSelectedPersonalIds(new Set());
      Alert.alert('Hotovo', `Pridaných ${n} položiek.`);
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa pridať položky.');
    } finally {
      setImportBusy(false);
    }
  }, [householdPantryCtx, selectedPersonalItems, refetch]);

  const handleAddAllToShared = useCallback(async () => {
    if (!householdPantryCtx || !personalForImport.length) return;
    const n = personalForImport.length;
    setImportBusy(true);
    try {
      await addPantryItems(householdPantryCtx, payloadFromPersonalItems(personalForImport));
      await refetch();
      setImportModalVisible(false);
      setSelectedPersonalIds(new Set());
      Alert.alert('Hotovo', `Pridaných ${n} položiek.`);
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa pridať položky.');
    } finally {
      setImportBusy(false);
    }
  }, [householdPantryCtx, personalForImport, refetch]);

  // Predpočítané dáta s parsenou expiráciou + dni do expirácie. Posortujeme od
  // tých, ktorým končí najskôr, na konci ide "no-date" zoznam pre vizuálnu konzistenciu.
  const itemsWithExpiry = useMemo(
    () =>
      (items || []).map((it) => {
        const expDate = parseExpiryDate(it.expiresAt);
        return { ...it, expDate, daysLeft: daysUntil(expDate) };
      }),
    [items],
  );
  const expiringSoon = useMemo(
    () =>
      itemsWithExpiry
        .filter((it) => it.daysLeft != null && it.daysLeft <= EXPIRY_SOON_DAYS)
        .sort((a, b) => a.daysLeft - b.daysLeft),
    [itemsWithExpiry],
  );

  const searchNorm = useMemo(() => normalizeName(searchQuery), [searchQuery]);
  const expiringSoonFiltered = useMemo(() => {
    if (!searchNorm) return expiringSoon;
    return expiringSoon.filter((it) => normalizeName(it.name).includes(searchNorm));
  }, [expiringSoon, searchNorm]);
  const displayedPantryItems = useMemo(() => {
    if (!searchNorm) return itemsWithExpiry;
    return itemsWithExpiry.filter((it) => normalizeName(it.name).includes(searchNorm));
  }, [itemsWithExpiry, searchNorm]);

  // Okno zoznamu položiek – vnútorný vertikálny scroll.

  const pantryItemsListMaxHeight = useMemo(
    () => Math.min(380, Math.max(200, Math.round(windowHeight * 0.36))),
    [windowHeight]
  );

  useFocusEffect(
    useCallback(() => {
      if (!uid) {
        setUserHouseholds([]);
        return;
      }
      listHouseholdsForUser(uid)
        .then(setUserHouseholds)
        .catch(() => setUserHouseholds([]));
    }, [uid])
  );

  useEffect(() => {
    dedupeRanRef.current = false;
  }, [effectiveHouseholdId]);

  useEffect(() => {
    if (!uid || !items?.length) {
      setLeftoverTips([]);
      setTipsLoading(false);
      return;
    }
    let cancelled = false;
    setTipsLoading(true);
    recommendRecipes(uid, { limit: 12, pantryItems: items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })) })
      .then(async (list) => {
        if (cancelled) return;
        const candidates = (list || []).filter((r) => (r.pantryMatchCount ?? 0) > 0).slice(0, 8);
        const enriched = await Promise.all(
          candidates.map(async (r) => {
            let full = r;
            try {
              const fetched = await getRecipe(r.id);
              if (fetched) full = { ...fetched, id: r.id };
            } catch (_) {
              }
            const servings = full.servings ?? r.servings ?? 1;
            const { lineCount, atHomeCount } = summarizePantryCoverage(full, servings, items);
            return { ...r, tipLineCount: lineCount, tipAtHomeCount: atHomeCount };
          })
        );
        const tips = enriched
          .filter((r) => r.tipLineCount > 0 && r.tipAtHomeCount > 0)
          .sort((a, b) => {
            if (b.tipAtHomeCount !== a.tipAtHomeCount) return b.tipAtHomeCount - a.tipAtHomeCount;
            return b.tipLineCount - a.tipLineCount;
          })
          .slice(0, 3);
        if (!cancelled) {
          setLeftoverTips(tips);
          setTipsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLeftoverTips([]);
          setTipsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uid, items]);

  useEffect(() => {
    if (!uid || loading || dedupeRanRef.current) return;
    if ((items || []).length < 2) {
      dedupeRanRef.current = true;
      return;
    }
    mergeDuplicates()
      .then((changed) => {
        if (changed) refetch();
      })
      .finally(() => {
        dedupeRanRef.current = true;
      });
  }, [uid, loading, items, mergeDuplicates, refetch]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      setHydrating(true);
      refetch()
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            hydratedOnceRef.current = true;
            setHydrating(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [refetch])
  );

  const openAdd = () => {
    setEditing(null);
    setName('');
    setQty('1');
    setUnit('ks');
    setExpiresAt(null);
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setName(item.name);
    setQty(String(item.qty ?? 1));
    setUnit(item.unit || 'ks');
    setExpiresAt(parseExpiryDate(item.expiresAt));
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
    setShowDatePicker(false);
  };

  const openExpiryPicker = () => {
    setShowDatePicker((v) => !v);
  };

  const handleSave = async () => {
    const n = name.trim();
    if (!n) return;
    const q = parseFloat(qty) || 1;
    if (!uid) return;
    setSaving(true);
    try {
      const payload = {
        name: n,
        qty: q,
        unit,
        // null explicitne, aby update vymazal staré expiresAt, keď ho používateľ odstráni.
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      };
      if (editing) {
        await update(editing.id, payload);
      } else {
        await add(payload);
      }
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item) => {
    Alert.alert('Zmazať položku', `Naozaj zmazať „${item.name}"?`, [
      { text: 'Zrušiť', style: 'cancel' },
      { text: 'Zmazať', style: 'destructive', onPress: () => remove(item.id) },
    ]);
  };

  const handlePullRefresh = async () => {
    setPullRefreshing(true);
    try {
      await refetch();
    } finally {
      setPullRefreshing(false);
    }
  };

  useEffect(() => {
    if (items.length === 0) {
      setFullPantryModalVisible(false);
    }
  }, [items.length]);

  const renderPantryItemRow = (item) => {
    const isUrgent = item.daysLeft != null && item.daysLeft <= EXPIRY_SOON_DAYS;
    return (
      <View key={item.id} style={styles.itemRow}>
        <TouchableOpacity style={styles.itemContent} onPress={() => openEdit(item)}>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.itemQty}>
            {item.qty} {item.unit ?? 'ks'}
            {item.expDate ? (
              <Text style={[styles.itemExpiry, isUrgent && styles.itemExpiryUrgent]}>
                {' '}
                · expir. {formatExpiry(item.expDate)}
              </Text>
            ) : null}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDelete(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  const importListMaxH = Math.min(340, Math.max(200, Math.round(windowHeight * 0.42)));

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={pullRefreshing} onRefresh={handlePullRefresh} tintColor={colors.primary} />
      }
    >
      {(loading || hydrating) && items.length === 0 ? (
        <View style={styles.inlinePantryLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.inlinePantryLoadingText}>Načítavam špajzu…</Text>
        </View>
      ) : null}
      <Text style={styles.sectionSubtitle}>
        Prehľad zásob, expirácie a receptov zo surovín, ktoré už máš doma.
      </Text>

      {userHouseholds.length > 0 ? (
        <View style={styles.scopeToggle}>
          <View style={styles.scopeChips}>
            <TouchableOpacity
              style={[styles.scopeChip, pantryScope === 'personal' && styles.scopeChipOn]}
              onPress={() => setPantryScope('personal')}
              activeOpacity={0.85}
            >
              <Ionicons
                name="person-outline"
                size={16}
                color={pantryScope === 'personal' ? '#FFFFFF' : colors.textMuted}
              />
              <Text style={[styles.scopeChipText, pantryScope === 'personal' && styles.scopeChipTextOn]}>
                Osobná
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scopeChip, pantryScope === 'household' && styles.scopeChipOn]}
              onPress={async () => {
                setPantryScope('household');
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
                color={pantryScope === 'household' ? '#FFFFFF' : colors.textMuted}
              />
              <Text style={[styles.scopeChipText, pantryScope === 'household' && styles.scopeChipTextOn]}>
                Domácnosť
              </Text>
            </TouchableOpacity>
          </View>
          {pantryScope === 'household' ? (
            <>
              <Text style={styles.scopeHint}>
                {(() => {
                  const hn = userHouseholds.find((h) => h.id === primaryHouseholdId)?.name;
                  return hn ? `„${hn}" · zdieľané s nákupom` : 'Zdieľaná špajza';
                })()}
              </Text>
              {effectiveHouseholdId ? (
                <TouchableOpacity
                  style={styles.importFromPersonalBtn}
                  onPress={openImportFromPersonal}
                  activeOpacity={0.85}
                  disabled={importBusy}
                >
                  <Ionicons name="download-outline" size={18} color={colors.primary} />
                  <Text style={styles.importFromPersonalBtnText}>Pridať z osobnej</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {items.length > 0 ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Hľadať podľa názvu…"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {expiringSoonFiltered.length > 0 && (
        <Card variant="white" paddingSize="medium" style={[styles.expiryCard, shadows.small, styles.pantryAccentWarning]}>
          <View style={[styles.categoryHeader, styles.expiryHeaderRow]}>
            <View style={[styles.categoryIconCircle, { backgroundColor: colors.tintWarningSurface }]}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.expiryTitle}>Čoskoro expiruje</Text>
              <Text style={styles.expirySubtitle}>
                Tieto položky stojí za to spotrebovať najbližších {EXPIRY_SOON_DAYS} dní.
              </Text>
            </View>
          </View>
          {expiringSoonFiltered.map((it) => (
            <TouchableOpacity
              key={it.id}
              style={styles.expiryItem}
              activeOpacity={0.85}
              onPress={() => openEdit(it)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.expiryItemName}>{it.name}</Text>
                <Text style={styles.expiryItemDays}>
                  {it.daysLeft < 0
                    ? `Prešlo o ${Math.abs(it.daysLeft)} ${Math.abs(it.daysLeft) === 1 ? 'deň' : 'dni'}`
                    : it.daysLeft === 0
                      ? 'Expiruje dnes'
                      : it.daysLeft === 1
                        ? 'Zostáva 1 deň'
                        : `Zostáva ${it.daysLeft} dní`}
                </Text>
              </View>
              <Text style={styles.expiryItemQty}>
                {it.qty} {it.unit ?? 'ks'}
              </Text>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      <Card variant="white" paddingSize="medium" style={[styles.listCard, shadows.medium]}>
        {items.length === 0 ? (
          <>
            <View style={styles.categoryHeader}>
              <View style={styles.categoryIconCircle}>
                <Ionicons name="basket-outline" size={16} color={colors.primary} />
              </View>
              <Text style={styles.categoryLabel}>Položky (g / ml / ks)</Text>
            </View>
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {effectiveHouseholdId
                  ? 'Zdieľaná špajza je prázdna. Pridaj položky + alebo z osobnej.'
                  : 'Zatiaľ žiadne položky. Pridaj ich + alebo testovaciu špajzu.'}
              </Text>
              {uid && !effectiveHouseholdId ? (
                <Button
                  title={seeding ? 'Vytváram…' : 'Vytvoriť testovaciu špajzu'}
                  onPress={async () => {
                    setSeeding(true);
                    try {
                      await seedTestPantry(buildUserPantryContext(uid));
                      await refetch();
                    } finally {
                      setSeeding(false);
                    }
                  }}
                  variant="secondary"
                  loading={seeding}
                  style={styles.seedBtn}
                />
              ) : null}
            </View>
          </>
        ) : (
          <>
            <View style={styles.categoryHeaderRowActions}>
              <TouchableOpacity
                style={[styles.categoryHeaderExpandable, styles.categoryHeaderExpandableFlex]}
                onPress={() => setPantrySectionExpanded((v) => !v)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ expanded: pantrySectionExpanded }}
                accessibilityLabel={
                  pantrySectionExpanded ? 'Zbaliť zoznam položiek' : 'Rozbaliť zoznam položiek'
                }
              >
                <View style={styles.categoryHeaderExpandableLeft}>
                  <View style={styles.categoryIconCircle}>
                    <Ionicons name="basket-outline" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.categoryHeaderTitles}>
                    <Text style={styles.categoryLabel}>Položky (g / ml / ks)</Text>
                    <Text style={styles.categoryHeaderHint}>
                      {pantrySectionExpanded
                        ? 'Ťukni pre zbalenie'
                        : 'Ťukni pre zobrazenie položiek'}{' '}
                      ({displayedPantryItems.length})
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={pantrySectionExpanded ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={colors.primary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFullPantryModalVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.categoryHeaderFullscreenBtn}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Špajza na celú obrazovku"
              >
                <Ionicons name="expand-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            {displayedPantryItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Žiadna položka nevyhovuje hľadaniu.</Text>
                <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7} style={styles.clearSearchBtn}>
                  <Text style={styles.clearSearchText}>Vymazať vyhľadávanie</Text>
                </TouchableOpacity>
              </View>
            ) : pantrySectionExpanded ? (
              <ScrollView
                style={[styles.pantryItemsScroll, { maxHeight: pantryItemsListMaxHeight }]}
                contentContainerStyle={styles.pantryItemsScrollContent}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {displayedPantryItems.map((item) => renderPantryItemRow(item))}
              </ScrollView>
            ) : null}
          </>
        )}
      </Card>

      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Card variant="white" paddingSize="medium" style={[styles.tipsCard, shadows.small, styles.pantryAccentTips]}>
        <View style={styles.categoryHeader}>
          <View style={styles.categoryIconCircle}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
          </View>
          <Text style={styles.tipsTitle}>Tipy na zvyšky</Text>
        </View>
        {tipsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : leftoverTips.length === 0 ? (
          <Text style={styles.tipsText}>Pridaj viac surovín do špajze a ukážeme recepty, ktoré vieš uvariť.</Text>
        ) : (
          leftoverTips.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.tipRow}
              activeOpacity={0.85}
              onPress={() =>
                openRecipeDetail(navigation, { recipeId: r.id, initialRecipe: r })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.tipName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.tipMeta}>
                  Máš {r.tipAtHomeCount} z {r.tipLineCount} ingred. doma
                  {typeof r.durationMin === 'number' ? ` · ${r.durationMin} min` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          ))
        )}
      </Card>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editing ? 'Upraviť položku' : 'Nová položka'}</Text>
            <TextInput
              style={styles.input}
              placeholder="Názov (napr. múka)"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.inputQty]}
                placeholder="Množstvo"
                placeholderTextColor={colors.textMuted}
                value={qty}
                onChangeText={setQty}
                keyboardType="decimal-pad"
              />
              <View style={styles.unitRow}>
                {UNITS_PANTRY.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitChip, unit === u && styles.unitChipActive]}
                    onPress={() => setUnit(u)}
                  >
                    <Text style={[styles.unitChipText, unit === u && styles.unitChipTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <Text style={styles.fieldLabel}>Dátum expirácie (voliteľné)</Text>
            <View style={styles.expiryFieldRow}>
              <TouchableOpacity
                onPress={openExpiryPicker}
                style={[styles.input, styles.expiryFieldBtn]}
                activeOpacity={0.85}
              >
                <Text style={[styles.expiryFieldText, !expiresAt && styles.expiryFieldTextEmpty]}>
                  {expiresAt ? formatExpiry(expiresAt) : 'Vybrať dátum'}
                </Text>
              </TouchableOpacity>
              {expiresAt && (
                <TouchableOpacity onPress={() => setExpiresAt(null)} hitSlop={8}>
                  <Text style={styles.expiryClearText}>Vymazať</Text>
                </TouchableOpacity>
              )}
            </View>
            {showDatePicker && (
              <View style={styles.datePickerInlineWrap}>
                <DateTimePicker
                  value={expiresAt || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  minimumDate={startOfToday()}
                  textColor={Platform.OS === 'ios' ? colors.textPrimary : undefined}
                  accentColor={Platform.OS === 'ios' ? colors.primary : undefined}
                  themeVariant={Platform.OS === 'ios' ? (isDark ? 'dark' : 'light') : undefined}
                  style={Platform.OS === 'ios' ? styles.iosDatePicker : undefined}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setShowDatePicker(false);
                    if (event?.type === 'dismissed') return;
                    if (selected) setExpiresAt(selected);
                  }}
                />
                {Platform.OS === 'ios' && (
                  <View style={styles.datePickerInlineActions}>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)} style={styles.datePickerInlineBtn}>
                      <Text style={styles.datePickerInlineBtnText}>Hotovo</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <View style={styles.modalActions}>
              <Button title="Zrušiť" onPress={closeModal} variant="outline" style={styles.modalBtn} />
              <Button title={saving ? 'Ukladám…' : 'Uložiť'} onPress={handleSave} variant="primary" loading={saving} style={styles.modalBtn} />
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>

    <Modal
      visible={fullPantryModalVisible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setFullPantryModalVisible(false)}
    >
      <View
        style={[
          styles.fullPantryModalRoot,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.fullPantryModalHeader}>
          <TouchableOpacity
            onPress={() => setFullPantryModalVisible(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Zavrieť"
          >
            <Ionicons name="close" size={28} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.fullPantryModalTitle} numberOfLines={1}>
            Špajza
          </Text>
          <View style={styles.fullPantryModalHeaderSpacer} />
        </View>
        <ScrollView
          style={styles.fullPantryModalScroll}
          contentContainerStyle={styles.fullPantryModalScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {displayedPantryItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Žiadna položka nevyhovuje hľadaniu.</Text>
              <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7} style={styles.clearSearchBtn}>
                <Text style={styles.clearSearchText}>Vymazať vyhľadávanie</Text>
              </TouchableOpacity>
            </View>
          ) : (
            displayedPantryItems.map((item) => renderPantryItemRow(item))
          )}
        </ScrollView>
      </View>
    </Modal>

    <Modal
      visible={importModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!importBusy) setImportModalVisible(false);
      }}
    >
      <View style={styles.importModalOverlay}>
        <View style={styles.importModalCard}>
          <View style={styles.importModalHeader}>
            <Text style={styles.importModalTitle}>Osobná špajza</Text>
            <TouchableOpacity
              onPress={() => {
                if (!importBusy) setImportModalVisible(false);
              }}
              hitSlop={12}
              accessibilityLabel="Zavrieť"
            >
              <Ionicons name="close" size={26} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          {importListLoading ? (
            <ActivityIndicator style={styles.importModalSpinner} color={colors.primary} size="large" />
          ) : personalForImport.length === 0 ? (
            <Text style={styles.importEmpty}>Prázdne.</Text>
          ) : (
            <>
              <View style={styles.importToolbar}>
                <View style={styles.importToolbarLeft}>
                  <TouchableOpacity onPress={selectAllPersonalForImport} hitSlop={8} disabled={importBusy}>
                    <Text style={styles.importToolbarLink}>Všetko</Text>
                  </TouchableOpacity>
                  <Text style={styles.importToolbarSep}>·</Text>
                  <TouchableOpacity onPress={clearPersonalImportSelection} hitSlop={8} disabled={importBusy}>
                    <Text style={styles.importToolbarLinkMuted}>Nič</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={handleAddAllToShared} hitSlop={8} disabled={importBusy}>
                  <Text style={styles.importToolbarLink}>Všetko pridať</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={[styles.importListScroll, { maxHeight: importListMaxH }]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {personalForImport.map((p) => {
                  const checked = selectedPersonalIds.has(p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.importRow, checked && styles.importRowSelected]}
                      onPress={() => togglePersonalImportSelect(p.id)}
                      disabled={importBusy}
                      activeOpacity={0.65}
                    >
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={checked ? colors.primary : colors.textMuted}
                        style={styles.importRowCheckIcon}
                      />
                      <View style={styles.importRowMain}>
                        <Text style={styles.importRowName} numberOfLines={2}>
                          {p.name}
                        </Text>
                        <Text style={styles.importRowMeta}>
                          {p.qty} {p.unit || 'ks'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
          {!importListLoading && personalForImport.length > 0 ? (
            <View style={styles.importFooter}>
              <Button
                title={importBusy ? '…' : `Pridať (${selectedPersonalItems.length})`}
                variant="primary"
                onPress={handleAddSelectedToShared}
                disabled={importBusy || selectedPersonalItems.length === 0}
                style={styles.importFooterBtn}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
    </>
  );
}

function createPantryStyles(colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  inlinePantryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
  },
  inlinePantryLoadingText: { ...typography.caption, color: colors.textMuted, marginLeft: spacing.sm },
  sectionSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  scopeToggle: {
    marginBottom: spacing.md,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
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
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scopeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  scopeChipText: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  scopeChipTextOn: { color: '#FFFFFF' },
  scopeHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontSize: 12 },
  importFromPersonalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.borderIndigo,
    backgroundColor: colors.surfaceRaised,
  },
  importFromPersonalBtnText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  importModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  importModalCard: {
    backgroundColor: colors.backgroundPrimary,
    borderTopLeftRadius: radius.xLarge || 20,
    borderTopRightRadius: radius.xLarge || 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '92%',
  },
  importModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  importModalTitle: {
    ...typography.title,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  importModalSpinner: { marginVertical: spacing.xl },
  importEmpty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  importToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  importToolbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  importToolbarSep: { fontSize: 13, color: colors.textMuted },
  importToolbarLink: { ...typography.caption, fontWeight: '700', color: colors.primary, fontSize: 13 },
  importToolbarLinkMuted: { ...typography.caption, fontWeight: '600', color: colors.textMuted, fontSize: 13 },
  importListScroll: { marginBottom: spacing.sm },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.medium,
    marginBottom: 4,
    gap: spacing.sm,
  },
  importRowSelected: {
    backgroundColor: colors.surfaceIndigo,
  },
  importRowCheckIcon: { marginRight: 2 },
  importRowMain: { flex: 1, minWidth: 0 },
  importRowName: { ...typography.body, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  importRowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  importFooter: { marginTop: spacing.md, gap: spacing.sm },
  importFooterBtn: { width: '100%' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchIcon: { marginRight: spacing.xs },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearSearchBtn: { alignSelf: 'flex-start', marginTop: spacing.sm },
  clearSearchText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  listCard: {
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  pantryItemsScroll: {
    flexGrow: 0,
  },
  pantryItemsScrollContent: {
    paddingBottom: spacing.xs,
  },
  emptyState: { marginTop: spacing.sm },
  seedBtn: { marginTop: spacing.md },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  categoryIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tintPrimarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
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
  fullPantryModalRoot: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  fullPantryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fullPantryModalTitle: {
    ...typography.h4,
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  fullPantryModalHeaderSpacer: {
    width: 28,
  },
  fullPantryModalScroll: {
    flex: 1,
  },
  fullPantryModalScrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.medium,
    backgroundColor: colors.surfaceRow,
    marginBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  itemContent: { flex: 1 },
  itemName: { ...typography.body, color: colors.textPrimary },
  itemQty: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  itemExpiry: { ...typography.caption, color: colors.textMuted },
  itemExpiryUrgent: { color: colors.error, fontWeight: '600' },
  pantryAccentWarning: {
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  pantryAccentTips: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  expiryCard: { marginBottom: spacing.lg },
  expiryHeaderRow: { alignItems: 'flex-start' },
  expiryTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: 2 },
  expirySubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  expiryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.medium,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  expiryItemName: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  expiryItemDays: { ...typography.caption, color: colors.error, marginTop: 2 },
  expiryItemQty: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.md },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  expiryFieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  expiryFieldBtn: { flex: 1, marginBottom: 0, justifyContent: 'center' },
  expiryFieldText: { ...typography.body, color: colors.textPrimary },
  expiryFieldTextEmpty: { color: colors.textMuted },
  expiryClearText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  deleteBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginBottom: spacing.lg,
    ...shadows.medium,
  },
  fabText: { fontSize: 28, color: '#FFFFFF', fontWeight: '300', lineHeight: 32 },
  tipsCard: { marginBottom: spacing.lg },
  tipsTitle: { ...typography.h4, color: colors.textPrimary },
  tipsText: { ...typography.caption, color: colors.textMuted },
  tipRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tipName: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  tipMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.xl,
    ...shadows.large,
  },
  modalTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  inputQty: { marginBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  unitRow: { flexDirection: 'row', marginLeft: spacing.md, gap: spacing.sm },
  unitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundSecondary,
  },
  unitChipActive: { backgroundColor: colors.primary },
  unitChipText: { ...typography.body, color: colors.textPrimary },
  unitChipTextActive: { color: '#FFF' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
  modalBtn: { minWidth: 100 },
  datePickerInlineWrap: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundSecondary,
    overflow: 'hidden',
  },
  iosDatePicker: {
    height: 180,
    backgroundColor: colors.backgroundPrimary,
  },
  datePickerInlineActions: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  datePickerInlineBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.medium,
    backgroundColor: colors.tintPrimarySurface,
  },
  datePickerInlineBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
}
