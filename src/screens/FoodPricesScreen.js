// Vlastné jednotkové ceny používateľa (prepisujú globálny cenník).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Button from '../components/ui/Button';
import { useAuthUser } from '../hooks/useAuthUser';
import {
  getUserPriceOverridesMap,
  setUserPriceOverride,
  deleteUserPriceOverride,
} from '../services/firestore/priceOverrides';
import { clearCatalogCache } from '../services/prices';
import { clearRecipeListPriceCache } from '../hooks/useRecipeListPrices';
import { clearRecipePriceCache } from '../hooks/useRecipePrice';
import { toSlugForPrice } from '../services/normalize';

const UNIT_OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'l' },
  { value: 'ml', label: 'ml' },
  { value: 'ks', label: 'ks' },
];

const HERO_TINT = 'rgba(255, 214, 232, 0.55)';

function tsToMs(v) {
  if (!v) return 0;
  if (typeof v === 'string') {
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : 0;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

function catalogBaselineEur(row) {
  const offers = row.offers;
  if (Array.isArray(offers) && offers.length > 0) {
    const nums = offers.map((o) => Number(o.priceEur)).filter((x) => Number.isFinite(x) && x > 0);
    if (nums.length) return Math.min(...nums);
  }
  const p = Number(row.priceEur);
  return Number.isFinite(p) && p > 0 ? p : 0;
}

function unitLabel(u) {
  const x = String(u || 'ks').toLowerCase();
  if (x === 'kg') return 'kg';
  if (x === 'g') return 'g';
  if (x === 'l') return 'l';
  if (x === 'ml') return 'ml';
  if (x === 'ks') return 'ks';
  return x;
}

function parsePriceInput(s) {
  const t = String(s ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

function formatPriceForInput(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded).replace('.', ',');
}

function invalidateCachesAndReload(loadAll) {
  clearCatalogCache();
  clearRecipeListPriceCache();
  clearRecipePriceCache();
  return loadAll();
}

export default function FoodPricesScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createFoodPricesStyles(colors), [colors]);
  const { user } = useAuthUser();
  const uid = user?.uid;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState({});
  const [ownExpanded, setOwnExpanded] = useState(false);
  const [ownDrafts, setOwnDrafts] = useState({});

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUnit, setAddUnit] = useState('kg');
  const [addPrice, setAddPrice] = useState('');

  const loadAll = useCallback(async () => {
    if (!uid) {
      setRows([]);
      setOverrides({});
      setLoading(false);
      return;
    }
    const [snap, ov] = await Promise.all([
      getDocs(collection(db, 'prices')),
      getUserPriceOverridesMap(uid, { forceRefresh: true }),
    ]);
    const list = [];
    snap.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });
    list.sort((a, b) => {
      const an = (a.name || a.id || '').toString();
      const bn = (b.name || b.id || '').toString();
      return an.localeCompare(bn, 'sk');
    });
    const o = ov || {};
    setRows(list);
    setOverrides(o);

    const nextDrafts = {};
    for (const r of list) {
      const base = catalogBaselineEur(r);
      const ovRow = o[r.id];
      const eff = ovRow && Number(ovRow.priceEur) > 0 ? Number(ovRow.priceEur) : base;
      nextDrafts[r.id] = formatPriceForInput(eff);
    }
    setDrafts(nextDrafts);

    const od = {};
    for (const id of Object.keys(o)) {
      const x = o[id];
      if (!x || typeof x.priceEur !== 'number' || !(x.priceEur > 0)) continue;
      if (!list.some((r) => r.id === id)) {
        od[id] = formatPriceForInput(x.priceEur);
      }
    }
    setOwnDrafts((prev) => {
      const merged = { ...od };
      for (const k of Object.keys(prev)) {
        if (o[k] && merged[k] === undefined) merged[k] = prev[k];
      }
      return merged;
    });
  }, [uid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await loadAll();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    if (!uid) return;
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [uid, loadAll]);

  const ownEditsList = useMemo(() => {
    const out = [];
    for (const id of Object.keys(overrides)) {
      const o = overrides[id];
      if (!o || typeof o.priceEur !== 'number' || !(o.priceEur > 0)) continue;
      const row = rows.find((r) => r.id === id);
      const name = row?.name || o.displayName || id;
      const unit = row?.unit || o.unit || 'ks';
      out.push({
        id,
        name,
        unit: unitLabel(unit),
        priceEur: o.priceEur,
        isCustom: !!o.isCustom,
        inCatalog: !!row,
      });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'sk'));
    return out;
  }, [overrides, rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = (r.name || '').toLowerCase();
      const id = (r.id || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [rows, query]);

  const persistPrice = useCallback(
    async (row, rawDraft) => {
      if (!uid || !row?.id) return;
      const parsed = parsePriceInput(rawDraft);
      const baseline = catalogBaselineEur(row);
      const hadOverride = !!(overrides[row.id] && Number(overrides[row.id].priceEur) > 0);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        if (hadOverride) {
          await deleteUserPriceOverride(uid, row.id);
        }
        setDrafts((d) => ({ ...d, [row.id]: formatPriceForInput(baseline) }));
        await invalidateCachesAndReload(loadAll);
        return;
      }

      const sameAsCatalog = baseline > 0 && Math.abs(parsed - baseline) < 0.0005;
      if (sameAsCatalog && !hadOverride) {
        return;
      }

      if (sameAsCatalog && hadOverride) {
        await deleteUserPriceOverride(uid, row.id);
      } else {
        await setUserPriceOverride(uid, row.id, parsed, { isCustom: false });
      }

      await invalidateCachesAndReload(loadAll);
    },
    [uid, overrides, loadAll]
  );

  const persistOwnRow = useCallback(
    async (item, rawDraft) => {
      if (!uid || !item?.id) return;
      const parsed = parsePriceInput(rawDraft);
      const row = rows.find((r) => r.id === item.id);
      const baseline = row ? catalogBaselineEur(row) : 0;
      const hadOverride = !!(overrides[item.id] && Number(overrides[item.id].priceEur) > 0);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        if (hadOverride) await deleteUserPriceOverride(uid, item.id);
        setOwnDrafts((d) => ({
          ...d,
          [item.id]: row ? formatPriceForInput(baseline) : formatPriceForInput(Number(overrides[item.id]?.priceEur) || 0),
        }));
        await invalidateCachesAndReload(loadAll);
        return;
      }

      if (row) {
        const sameAsCatalog = baseline > 0 && Math.abs(parsed - baseline) < 0.0005;
        if (sameAsCatalog && hadOverride) {
          await deleteUserPriceOverride(uid, item.id);
        } else if (!sameAsCatalog) {
          await setUserPriceOverride(uid, item.id, parsed, { isCustom: false });
        } else if (sameAsCatalog && !hadOverride) {
          return;
        }
      } else {
        await setUserPriceOverride(uid, item.id, parsed, {
          displayName: overrides[item.id]?.displayName || item.name,
          unit: overrides[item.id]?.unit || item.unit,
          isCustom: true,
        });
      }
      await invalidateCachesAndReload(loadAll);
    },
    [uid, overrides, rows, loadAll]
  );

  const saveNewCustom = useCallback(async () => {
    if (!uid) return;
    const name = addName.trim();
    if (!name) {
      Alert.alert('Chýba názov', 'Zadaj názov potraviny.');
      return;
    }
    const slug = toSlugForPrice(name);
    if (!slug) {
      Alert.alert('Neplatný názov', 'Skús jednoduchší názov (písmená, čísla).');
      return;
    }
    const docId = `${slug}_${addUnit}`;
    const price = parsePriceInput(addPrice);
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('Chýba cena', 'Zadaj cenu väčšiu ako 0.');
      return;
    }
    const existsInCatalog = rows.some((r) => r.id === docId);
    if (existsInCatalog) {
      Alert.alert(
        'Zhoda s katalógom',
        `ID „${docId}" už existuje v katalógi. Uprav cenu v zozname nižšie alebo zmeň jednotku / názov.`,
      );
      return;
    }
    try {
      await setUserPriceOverride(uid, docId, price, {
        displayName: name,
        unit: addUnit,
        isCustom: true,
      });
      setAddOpen(false);
      setAddName('');
      setAddPrice('');
      setAddUnit('kg');
      await invalidateCachesAndReload(loadAll);
      setOwnExpanded(true);
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Uloženie zlyhalo.');
    }
  }, [uid, addName, addUnit, addPrice, rows, loadAll]);

  const renderItem = useCallback(
    ({ item: row }) => {
      const id = row.id;
      const baseline = catalogBaselineEur(row);
      const u = overrides[id];
      const updatedMs = tsToMs(u?.updatedAt);
      const unit = unitLabel(row.unit);
      const draft = drafts[id] ?? '';
      const hasOverride = !!(u && Number(u.priceEur) > 0);

      return (
        <View style={[styles.rowSurface, shadows.small, hasOverride && styles.rowSurfaceHighlight]}>
          {hasOverride ? <View style={styles.rowAccent} /> : null}
          <View style={styles.rowInner}>
            <View style={styles.rowHead}>
              <View style={styles.rowTextCol}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {row.name || id}
                </Text>
                <View style={styles.metaPills}>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>
                      katalóg {baseline > 0 ? `${baseline.toFixed(2).replace('.', ',')} €` : '—'} / {unit}
                    </Text>
                  </View>
                  {updatedMs > 0 ? (
                    <View style={styles.pillMuted}>
                      <Text style={styles.pillTextMuted}>{new Date(updatedMs).toLocaleDateString('sk-SK')}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.priceBox}>
                <TextInput
                  style={styles.priceInput}
                  keyboardType="decimal-pad"
                  value={draft}
                  onChangeText={(t) => setDrafts((d) => ({ ...d, [id]: t }))}
                  onBlur={() => persistPrice(row, draft)}
                  placeholder={baseline > 0 ? formatPriceForInput(baseline) : '0,00'}
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.euroSuffix}>€</Text>
              </View>
            </View>
            <Text style={styles.rowHint}>
              Jednotka: cena za 1 {unit === 'kg' ? 'kg' : unit === 'l' ? 'l' : unit}. Uprav podľa obalu v obchode.
            </Text>
            {hasOverride ? (
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={() => {
                  Alert.alert('Obnoviť z katalógu?', 'Zmaže sa tvoja vlastná cena pre túto položku.', [
                    { text: 'Zrušiť', style: 'cancel' },
                    {
                      text: 'Obnoviť',
                      onPress: async () => {
                        await deleteUserPriceOverride(uid, id);
                        await invalidateCachesAndReload(loadAll);
                      },
                    },
                  ]);
                }}
              >
                <Text style={styles.resetBtnText}>Obnoviť z katalógu</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    },
    [drafts, overrides, uid, persistPrice, loadAll, styles]
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="pricetag" size={22} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Tvoje ceny</Text>
          <Text style={styles.heroSubtitle}>
            Ulož si poslednú známu cenu – odhad nákupu a receptov bude presnejší. Platí len pre tvoj účet.
          </Text>
        </View>

        <TouchableOpacity style={styles.addPrimary} onPress={() => setAddOpen(true)} activeOpacity={0.88}>
          <Ionicons name="add" size={22} color={colors.backgroundPrimary} />
          <Text style={styles.addPrimaryText}>Pridať vlastnú potravinu</Text>
        </TouchableOpacity>

        <View style={[styles.ownSection, shadows.small]}>
          <TouchableOpacity
            style={styles.ownHeaderRow}
            onPress={() => setOwnExpanded((e) => !e)}
            activeOpacity={0.85}
          >
            <View style={styles.ownIconWrap}>
              <Ionicons name="layers-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.ownHeaderText}>
              <Text style={styles.ownSectionTitle}>Vlastné úpravy</Text>
              <Text style={styles.ownSectionSubtitle}>Uložené ceny v katalógu aj mimo neho</Text>
            </View>
            <View style={styles.countChip}>
              <Text style={styles.countChipText}>{ownEditsList.length}</Text>
            </View>
            <View style={styles.chevronCircle}>
              <Ionicons name={ownExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {ownExpanded ? (
            <View style={styles.ownList}>
              {ownEditsList.length === 0 ? (
                <Text style={styles.ownEmpty}>
                  Zatiaľ žiadne vlastné ceny. Uprav položku v zozname alebo pridaj vlastnú potravinu.
                </Text>
              ) : (
                ownEditsList.map((item) => (
                  <View key={item.id} style={[styles.ownItemSurface, shadows.small]}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {item.name}
                      {item.isCustom && !item.inCatalog ? (
                        <Text style={styles.badgeCustom}> vlastná</Text>
                      ) : null}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {item.priceEur.toFixed(2).replace('.', ',')} € / {item.unit} · {item.id}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.ownItemInput]}
                      keyboardType="decimal-pad"
                      value={ownDrafts[item.id] ?? formatPriceForInput(item.priceEur)}
                      onChangeText={(t) => setOwnDrafts((d) => ({ ...d, [item.id]: t }))}
                      onBlur={() => persistOwnRow(item, ownDrafts[item.id] ?? formatPriceForInput(item.priceEur))}
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity
                      style={styles.resetBtn}
                      onPress={() => {
                        Alert.alert('Odstrániť úpravu?', `Záznam: ${item.name}`, [
                          { text: 'Zrušiť', style: 'cancel' },
                          {
                            text: 'Odstrániť',
                            style: 'destructive',
                            onPress: async () => {
                              await deleteUserPriceOverride(uid, item.id);
                              await invalidateCachesAndReload(loadAll);
                            },
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.resetDanger}>Odstrániť</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Hľadať v katalógu…"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <Text style={styles.catalogLabel}>Katalóg</Text>
      </View>
    ),
    [ownExpanded, ownEditsList, ownDrafts, query, uid, loadAll, persistOwnRow, styles]
  );

  if (!uid) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Prihlás sa, aby si mohla upravovať vlastné ceny.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.muted, { marginTop: spacing.md }]}>Načítavam cenník…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="file-tray-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Žiadne výsledky</Text>
            <Text style={styles.muted}>Skús iný výraz alebo vymaž vyhľadávanie.</Text>
          </View>
        }
        initialNumToRender={12}
        windowSize={8}
      />

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalAvoid}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Nová potravina</Text>
              <Text style={styles.modalHint}>
                Vytvorí sa tvoja cena pod kľúčom podobným ako v katalógi (napr. moja_zmes_kg). Pri recepte musí sedieť
                názov a jednotka.
              </Text>
              <Text style={styles.fieldLabel}>Názov</Text>
              <TextInput
                style={styles.inputFilled}
                value={addName}
                onChangeText={setAddName}
                placeholder="napr. Domáca zmes orechov"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.fieldLabel}>Jednotka ceny</Text>
              <View style={styles.unitRow}>
                {UNIT_OPTIONS.map((u) => (
                  <TouchableOpacity
                    key={u.value}
                    style={[styles.unitChip, addUnit === u.value && styles.unitChipOn]}
                    onPress={() => setAddUnit(u.value)}
                  >
                    <Text style={[styles.unitChipText, addUnit === u.value && styles.unitChipTextOn]}>{u.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fieldLabel}>Cena (€ za 1 jednotku)</Text>
              <TextInput
                style={styles.inputFilled}
                keyboardType="decimal-pad"
                value={addPrice}
                onChangeText={setAddPrice}
                placeholder="napr. 4,29"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.modalActions}>
                <Button title="Zrušiť" variant="outline" onPress={() => setAddOpen(false)} />
                <Button title="Uložiť" onPress={saveNewCustom} />
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

function createFoodPricesStyles(colors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundSecondary },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  headerBlock: { paddingBottom: spacing.md, paddingTop: spacing.xs },
  hero: {
    backgroundColor: HERO_TINT,
    borderRadius: radius.xLarge,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 157, 0.12)',
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.backgroundPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    ...shadows.small,
  },
  heroTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
  heroSubtitle: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
  addPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.large,
    marginBottom: spacing.lg,
    ...shadows.medium,
  },
  addPrimaryText: { ...typography.body, color: colors.backgroundPrimary, fontWeight: '700' },
  ownSection: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.xLarge,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  ownHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  ownIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownHeaderText: { flex: 1, minWidth: 0 },
  ownSectionTitle: { ...typography.h4, color: colors.textPrimary },
  ownSectionSubtitle: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  countChip: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.cardPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countChipText: { ...typography.caption, fontWeight: '700', color: colors.primary },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownList: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  ownEmpty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md, lineHeight: 20 },
  ownItemSurface: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.large,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  ownItemInput: { marginTop: spacing.sm },
  badgeCustom: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...shadows.small,
  },
  searchIcon: { marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    ...typography.body,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
  },
  catalogLabel: {
    ...typography.small,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  rowSurface: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSurfaceHighlight: {
    borderColor: 'rgba(255, 107, 157, 0.35)',
  },
  rowAccent: {
    width: 4,
    backgroundColor: colors.primary,
  },
  rowInner: { flex: 1, padding: spacing.md },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowTextCol: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  metaPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.small,
  },
  pillText: { ...typography.small, color: colors.textSecondary, fontWeight: '500' },
  pillMuted: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillTextMuted: { ...typography.small, color: colors.textMuted },
  priceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 104,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
  },
  priceInput: {
    flex: 1,
    minWidth: 56,
    ...typography.body,
    fontWeight: '600',
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  euroSuffix: { ...typography.caption, fontWeight: '700', color: colors.textMuted },
  rowHint: { ...typography.small, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundPrimary,
    color: colors.textPrimary,
  },
  inputFilled: {
    ...typography.body,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  resetBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  resetBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  resetDanger: { ...typography.caption, color: '#B91C1C', fontWeight: '600' },
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyTitle: { ...typography.h4, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.xs },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalAvoid: { width: '100%' },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(113, 128, 150, 0.35)',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.backgroundPrimary,
    borderTopLeftRadius: radius.xLarge,
    borderTopRightRadius: radius.xLarge,
    padding: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  modalHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20, textAlign: 'center' },
  fieldLabel: { ...typography.caption, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.xs },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  unitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
  },
  unitChipOn: { borderColor: colors.primary, backgroundColor: colors.cardPink },
  unitChipText: { ...typography.caption, color: colors.textPrimary },
  unitChipTextOn: { fontWeight: '700', color: colors.primary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
});
}
