// Rozpočet: týždenný limit, minuté sumy, história nákupov.
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Card from '../components/ui/Card';
import AnimatedBudgetRing from '../components/ui/AnimatedBudgetRing';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import { getBudgetCycleRange } from '../utils/budgetCycle';
import { getBudgetRingColorFromUsage, getBudgetUsageRatio } from '../utils/budgetColors';
import { getCurrentWeekMonday } from '../utils/dateHelpers';
import { getPurchaseHistory } from '../services/firestore/purchases';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BAR_MAX_WIDTH = SCREEN_WIDTH - spacing.lg * 2 - spacing.lg * 2;
function toMs(v) {
  if (v == null) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return 0;
}

function getEntryMs(entry) {
  const ms = toMs(entry.completedAt);
  if (ms > 0) return ms;
  return toMs(entry.updatedAt);
}

function formatDate(ms) {
  if (!ms) return '–';
  return new Date(ms).toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'short',
  });
}

export default function BudgetScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createBudgetStyles(colors), [colors]);
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile, updateProfile } = useProfile(uid);

  const [allPurchases, setAllPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [expandedWeekKey, setExpandedWeekKey] = useState(null);

  useFocusEffect(
    React.useCallback(() => {
      if (!uid) return;
      let cancelled = false;
      setLoading(true);
      setExpandedWeekKey(null);
      getPurchaseHistory(uid, 500).then((orders) => {
        if (cancelled) return;
        const normalized = (orders || []).map((o) => ({
          ...o,
          completedTotalEur: typeof o?.paidTotalEur === 'number'
            ? o.paidTotalEur
            : typeof o?.estTotalEur === 'number'
              ? o.estTotalEur
              : 0,
          completedAt: o?.createdAt || null,
        }));
        setAllPurchases(normalized);
        setLoading(false);
      });
      return () => { cancelled = true; };
    }, [uid])
  );

  const weeklyBudget = profile?.weeklyBudget ?? 50;

  const maxSanePurchase = weeklyBudget * 10;

  const validPurchases = useMemo(
    () => allPurchases.filter((p) => {
      const amt = typeof p.completedTotalEur === 'number' ? p.completedTotalEur : 0;
      return amt > 0 && amt <= maxSanePurchase;
    }),
    [allPurchases, maxSanePurchase]
  );

  const stats = useMemo(() => {
    const now = new Date();
    const { cycleStart, nextCycleStart } = getBudgetCycleRange(profile, now);

    const prevCycleStart = new Date(cycleStart);
    prevCycleStart.setDate(prevCycleStart.getDate() - 7);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevMonthStart.setHours(0, 0, 0, 0);

    let thisWeekSpent = 0;
    let prevWeekSpent = 0;
    let thisMonthSpent = 0;
    let prevMonthSpent = 0;
    let totalAllTime = 0;
    let purchaseCount = 0;

    // Kľúč týždňa = ISO dátum pondelka (zhodné s rozpočtovým cyklom po–ne).

    const weeklyData = {};

    const oldestBarMonday = new Date(cycleStart);
    oldestBarMonday.setDate(cycleStart.getDate() - 21);
    const oldestWeekMonday = getCurrentWeekMonday(oldestBarMonday);
    const chartWindowEndMs = nextCycleStart.getTime();

    for (const p of validPurchases) {
      const amt = p.completedTotalEur;

      totalAllTime += amt;
      purchaseCount += 1;

      const ms = getEntryMs(p);
      if (!ms) continue;

      if (ms >= cycleStart.getTime() && ms < nextCycleStart.getTime()) {
        thisWeekSpent += amt;
      }
      if (ms >= prevCycleStart.getTime() && ms < cycleStart.getTime()) {
        prevWeekSpent += amt;
      }
      if (ms >= monthStart.getTime()) {
        thisMonthSpent += amt;
      }
      if (ms >= prevMonthStart.getTime() && ms < monthStart.getTime()) {
        prevMonthSpent += amt;
      }

      const weekMonday = getCurrentWeekMonday(new Date(ms));
      const weekKey = mondayDateToIsoKey(weekMonday);
      if (weekMonday.getTime() >= oldestWeekMonday.getTime() && ms < chartWindowEndMs) {
        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { spent: 0, purchases: [] };
        }
        weeklyData[weekKey].spent += amt;
        weeklyData[weekKey].purchases.push({
          id: p.id,
          amount: amt,
          ms,
          store: typeof p.store === 'string' ? p.store : '',
        });
      }
    }

    for (const k of Object.keys(weeklyData)) {
      weeklyData[k].purchases.sort((a, b) => b.ms - a.ms);
    }

    const remaining = Math.max(0, weeklyBudget - thisWeekSpent);
    const pct = weeklyBudget > 0 ? Math.min(100, (thisWeekSpent / weeklyBudget) * 100) : 0;

    const last4Weeks = [];
    for (let i = 3; i >= 0; i -= 1) {
      const wStart = new Date(cycleStart);
      wStart.setDate(wStart.getDate() - i * 7);
      const monday = getCurrentWeekMonday(wStart);
      const weekKey = mondayDateToIsoKey(monday);
      const bucket = weeklyData[weekKey] || { spent: 0, purchases: [] };
      const wEnd = new Date(monday);
      wEnd.setDate(monday.getDate() + 6);
      const isCurrentWeek = i === 0;
      last4Weeks.push({
        weekKey,
        label: formatBudgetWeekRowLabel(monday, wEnd, isCurrentWeek),
        spent: round2(bucket.spent),
        purchases: bucket.purchases,
      });
    }

    return {
      thisWeekSpent: round2(thisWeekSpent),
      prevWeekSpent: round2(prevWeekSpent),
      thisMonthSpent: round2(thisMonthSpent),
      prevMonthSpent: round2(prevMonthSpent),
      totalAllTime: round2(totalAllTime),
      purchaseCount,
      remaining: round2(remaining),
      pct,
      last4Weeks,
    };
  }, [validPurchases, weeklyBudget]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const budgetUsageRatio = getBudgetUsageRatio(stats.thisWeekSpent, weeklyBudget);
  const ringColor = getBudgetRingColorFromUsage(budgetUsageRatio, colors);
  const maxBar = Math.max(...stats.last4Weeks.map((w) => w.spent), weeklyBudget, 1);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>Prehľad rozpočtu</Text>

      <Card variant="white" paddingSize="large" style={[styles.ringCard, shadows.medium]}>
        <View style={styles.budgetEditTopRow}>
          <Text style={styles.budgetEditTopLabel}>Týždenný limit</Text>
          {editingBudget ? (
            <View style={styles.budgetEditRow}>
              <TextInput
                style={styles.budgetInput}
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="numeric"
                autoFocus
                selectTextOnFocus
              />
              <TouchableOpacity
                style={styles.budgetSaveBtn}
                onPress={async () => {
                  const val = parseFloat(budgetInput.replace(',', '.'));
                  if (!Number.isFinite(val) || val <= 0) {
                    Alert.alert('Neplatná suma', 'Zadaj kladné číslo.');
                    return;
                  }
                  await updateProfile({ weeklyBudget: Math.round(val * 100) / 100 });
                  setEditingBudget(false);
                }}
              >
                <Text style={styles.budgetSaveBtnText}>Uložiť</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.budgetEditTopBtn}
              onPress={() => {
                setBudgetInput(String(weeklyBudget));
                setEditingBudget(true);
              }}
            >
              <Ionicons name="create-outline" size={14} color={colors.primary} />
              <Text style={styles.budgetEditTopBtnText}>Upraviť rozpočet</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.ringWrap}>
          <AnimatedBudgetRing
            spent={stats.thisWeekSpent}
            budget={weeklyBudget}
            size={160}
            strokeWidth={14}
          />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.thisWeekSpent.toFixed(2)} €</Text>
            <Text style={styles.statLabel}>Minuté</Text>
          </View>
          <View style={[styles.statItem, styles.statDivider]}>
            <Text style={styles.statValue}>{weeklyBudget} €</Text>
            <Text style={styles.statLabel}>Rozpočet</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.remaining.toFixed(2)} €</Text>
            <Text style={styles.statLabel}>Zostáva</Text>
          </View>
        </View>
      </Card>

      <Card variant="white" paddingSize="medium" style={[styles.card, shadows.small]}>
        <Text style={styles.cardTitle}>Využitie rozpočtu</Text>
        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.min(100, stats.pct)}%`,
                backgroundColor: ringColor,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {stats.pct.toFixed(0)}% využitých z {weeklyBudget} €
        </Text>
      </Card>

      <Card variant="white" paddingSize="medium" style={[styles.comparisonCard, shadows.small]}>
        <View style={styles.comparisonRowInner}>
          <View style={[styles.comparisonCell, styles.comparisonCellLeft]}>
            <View style={[styles.compAccentDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.compTitle}>Tento týždeň</Text>
            <Text style={styles.compValue}>{stats.thisWeekSpent.toFixed(2)} €</Text>
            <View style={styles.compDelta}>
              {stats.prevWeekSpent > 0 ? (
                <Text style={[styles.compDeltaText, {
                  color: stats.thisWeekSpent <= stats.prevWeekSpent ? colors.success : colors.error,
                }]}>
                  {stats.thisWeekSpent <= stats.prevWeekSpent ? '↓' : '↑'}{' '}
                  {Math.abs(stats.thisWeekSpent - stats.prevWeekSpent).toFixed(2)} €
                </Text>
              ) : (
                <Text style={styles.compDeltaText}>minulý: – €</Text>
              )}
            </View>
            <Text style={styles.compSubLabel}>vs minulý týždeň</Text>
          </View>
          <View style={styles.comparisonDivider} />
          <View style={[styles.comparisonCell, styles.comparisonCellRight]}>
            <View style={[styles.compAccentDot, { backgroundColor: colors.success }]} />
            <Text style={styles.compTitle}>Tento mesiac</Text>
            <Text style={styles.compValue}>{stats.thisMonthSpent.toFixed(2)} €</Text>
            <View style={styles.compDelta}>
              {stats.prevMonthSpent > 0 ? (
                <Text style={[styles.compDeltaText, {
                  color: stats.thisMonthSpent <= stats.prevMonthSpent ? colors.success : colors.error,
                }]}>
                  {stats.thisMonthSpent <= stats.prevMonthSpent ? '↓' : '↑'}{' '}
                  {Math.abs(stats.thisMonthSpent - stats.prevMonthSpent).toFixed(2)} €
                </Text>
              ) : (
                <Text style={styles.compDeltaText}>minulý: – €</Text>
              )}
            </View>
            <Text style={styles.compSubLabel}>vs minulý mesiac</Text>
          </View>
        </View>
      </Card>

      <Card variant="white" paddingSize="medium" style={[styles.card, shadows.small]}>
        <Text style={styles.cardTitle}>Posledné 4 týždne</Text>
        <Text style={styles.cardSubtitle}>
          Súčty podľa kalendárneho týždňa (po – ne). Ťukni na riadok pre zoznam nákupov.
        </Text>
        {stats.last4Weeks.map((week, weekIdx) => {
          const pct = maxBar > 0 ? (week.spent / maxBar) * 100 : 0;
          const isOver = week.spent > weeklyBudget;
          const isLastWeek = weekIdx === stats.last4Weeks.length - 1;
          const expanded = expandedWeekKey === week.weekKey;
          return (
            <View
              key={week.weekKey}
              style={[styles.weekBlock, isLastWeek && styles.weekBlockLast]}
            >
              <TouchableOpacity
                style={[styles.weekHeader, expanded && styles.weekHeaderExpanded]}
                onPress={() =>
                  setExpandedWeekKey((k) => (k === week.weekKey ? null : week.weekKey))
                }
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={
                  expanded
                    ? `Zbaliť ${week.label}`
                    : `Otvoriť detail nákupov, ${week.label}`
                }
              >
                <Text style={styles.barLabel} numberOfLines={2}>
                  {week.label}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.min(100, pct)}%`,
                        backgroundColor: isOver ? colors.error : colors.primary,
                      },
                    ]}
                  />
                  {weeklyBudget > 0 && (
                    <View
                      style={[
                        styles.budgetLine,
                        { left: `${Math.min(100, (weeklyBudget / maxBar) * 100)}%` },
                      ]}
                    />
                  )}
                </View>
                <View style={styles.barValueCol}>
                  <Text style={styles.barValue}>
                    {week.spent.toFixed(2)} €
                    {week.purchases.length > 0 ? (
                      <Text style={styles.barPurchaseCount}> · {week.purchases.length}</Text>
                    ) : null}
                  </Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                  />
                </View>
              </TouchableOpacity>
              {expanded ? (
                week.purchases.length === 0 ? (
                  <Text style={styles.weekNoPurchases}>Žiadne nákupy v tomto týždni</Text>
                ) : (
                  week.purchases.map((row) => (
                    <View key={row.id} style={styles.purchaseRow}>
                      <View style={styles.purchaseRowLeft}>
                        <Text style={styles.purchaseDate}>{formatDate(row.ms)}</Text>
                        {row.store ? (
                          <Text style={styles.purchaseStore} numberOfLines={1}>
                            {row.store}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.purchaseAmount}>{row.amount.toFixed(2)} €</Text>
                    </View>
                  ))
                )
              ) : null}
            </View>
          );
        })}
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={styles.legendText}>Súčet nákupov</Text>
          <View style={[styles.legendDot, { backgroundColor: colors.textMuted }]} />
          <Text style={styles.legendText}>Limit ({weeklyBudget} €)</Text>
        </View>
      </Card>

      <Card variant="white" paddingSize="medium" style={[styles.card, shadows.small]}>
        <Text style={styles.cardTitle}>Celkový prehľad</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{stats.purchaseCount}</Text>
            <Text style={styles.summaryLabel}>nákupov</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{stats.totalAllTime.toFixed(2)} €</Text>
            <Text style={styles.summaryLabel}>celkovo</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>
              {stats.purchaseCount > 0 ? (stats.totalAllTime / stats.purchaseCount).toFixed(2) : '–'} €
            </Text>
            <Text style={styles.summaryLabel}>priemerný nákup</Text>
          </View>
        </View>
      </Card>

    </ScrollView>
  );
}

function mondayDateToIsoKey(monday) {
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatBudgetWeekRowLabel(weekStartMonday, weekEndSunday, isCurrentWeek) {
  if (isCurrentWeek) {
    return 'Tento týždeň';
  }
  const fmt = (dt) =>
    dt.toLocaleDateString('sk-SK', {
      day: 'numeric',
      month: 'short',
    });
  return `${fmt(weekStartMonday)} – ${fmt(weekEndSunday)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function createBudgetStyles(colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  screenTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.lg },

  ringCard: { alignItems: 'center', marginBottom: spacing.lg },
  budgetEditTopRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  budgetEditTopLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  budgetEditTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 107, 157, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.medium,
  },
  budgetEditTopBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  ringWrap: { marginBottom: spacing.md, alignItems: 'center' },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: spacing.md,
  },
  statItem: { alignItems: 'center', flex: 1 },
  statDivider: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  statValue: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  budgetEditRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  budgetInput: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    minWidth: 50,
    textAlign: 'center',
    paddingVertical: 2,
  },
  budgetSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  budgetSaveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },

  card: { marginBottom: spacing.lg },
  cardTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
  cardSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 18,
  },

  progressBarBg: {
    height: 12,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: { height: 12, borderRadius: 6 },
  progressText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  comparisonCard: { marginBottom: spacing.lg },
  comparisonRowInner: { flexDirection: 'row', alignItems: 'stretch' },
  comparisonCell: { flex: 1, alignItems: 'flex-start' },
  comparisonCellLeft: { paddingRight: spacing.md },
  comparisonCellRight: { paddingLeft: spacing.md },
  comparisonDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    alignSelf: 'stretch',
  },
  compAccentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: spacing.sm,
  },
  compTitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  compValue: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  compDelta: { marginTop: spacing.xs },
  compDeltaText: { ...typography.caption, fontWeight: '600' },
  compSubLabel: { ...typography.small, color: colors.textMuted, marginTop: 2, fontSize: 10 },

  weekBlock: {
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  weekBlockLast: {
    borderBottomWidth: 0,
    marginBottom: 0,
    paddingBottom: 0,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radius.medium,
  },
  weekHeaderExpanded: {
    backgroundColor: colors.surfaceHighlight,
  },
  barValueCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 76,
    flexShrink: 0,
    justifyContent: 'flex-end',
  },
  barPurchaseCount: {
    ...typography.small,
    color: colors.textMuted,
    fontWeight: '500',
  },
  barLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    width: 100,
    flexShrink: 0,
    paddingRight: spacing.xs,
  },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: 8,
    marginHorizontal: spacing.sm,
    position: 'relative',
    overflow: 'hidden',
  },
  barFill: { height: 16, borderRadius: 8 },
  budgetLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
  },
  barValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', width: 52, textAlign: 'right' },
  weekNoPurchases: {
    ...typography.small,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginLeft: 100 + spacing.xs + spacing.sm,
  },
  purchaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingLeft: 100 + spacing.xs + spacing.sm,
    paddingRight: 0,
    gap: spacing.sm,
  },
  purchaseRowLeft: { flex: 1, minWidth: 0 },
  purchaseDate: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },
  purchaseStore: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  purchaseAmount: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },

  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.small, color: colors.textMuted, marginRight: spacing.sm },

  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: { alignItems: 'center' },
  summaryValue: { ...typography.h4, color: colors.textPrimary, fontWeight: '700' },
  summaryLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  });
}
