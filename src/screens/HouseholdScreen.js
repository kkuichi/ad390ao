// Zdieľaná domácnosť: pozvánky, spoločný nákupný zoznam.
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import {
  createHousehold,
  listHouseholdsForUser,
  createHouseholdInvite,
  listPendingInvitesForEmail,
  acceptHouseholdInvite,
  declineHouseholdInvite,
  deleteHousehold,
  syncHouseholdMemberSummary,
  fetchHouseholdMemberSummaries,
} from '../services/firestore/households';

// Meno z účtu / memberSummary, inak e-mail; spätná kompatibilita s memberNames.

function resolveMemberDisplayName(
  memberUid,
  household,
  summaries,
  selfUid,
  selfProfileName,
  selfUserDisplayName,
  selfEmail
) {
  const row = summaries?.[memberUid];
  const fromSummary = (row?.displayName || '').trim();
  if (fromSummary) return fromSummary;
  const fromSummaryEmail = (row?.emailLower || '').trim();
  if (fromSummaryEmail) return fromSummaryEmail;
  const legacy =
    typeof household.memberNames?.[memberUid] === 'string'
      ? household.memberNames[memberUid].trim()
      : '';
  if (legacy) return legacy;
  if (memberUid === selfUid) {
    const live = (selfProfileName || selfUserDisplayName || '').trim();
    if (live) return live;
    if (selfEmail) return selfEmail;
  }
  return 'Člen';
}

export default function HouseholdScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createHouseholdStyles(colors), [colors]);
  const { user } = useAuthUser();
  const uid = user?.uid;
  const email = (user?.email || '').trim().toLowerCase();
  const { profile, updateProfile, refetch: refetchProfile } = useProfile(uid);

  const [households, setHouseholds] = useState([]);
  const [memberSummaries, setMemberSummaries] = useState({});
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState({});
  const [busy, setBusy] = useState(false);

  const activeHouseholdId = profile?.activeHouseholdId ?? null;
  const activeHousehold = households.find((h) => h.id === activeHouseholdId);

  const load = useCallback(async () => {
    if (!uid) {
      setHouseholds([]);
      setMemberSummaries({});
      setInvites([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let h = [];
    let inv = [];
    try {
      h = await listHouseholdsForUser(uid);
    } catch (e) {
      if (__DEV__ && console?.warn) console.warn('[households] load households failed:', e);
    }
    try {
      inv = await listPendingInvitesForEmail(email);
    } catch (e) {
      if (__DEV__ && console?.warn) console.warn('[households] load invites failed:', e);
    }

    const myDisplay = (profile?.displayName || user?.displayName || '').trim();
    const memberOf = h.filter((hh) => (hh.memberUids || []).includes(uid));
    try {
      await Promise.all(
        memberOf.map((hh) =>
          syncHouseholdMemberSummary(hh.id, uid, {
            displayName: myDisplay,
            emailLower: email,
          })
        )
      );
    } catch (e) {
      if (__DEV__ && console?.warn) console.warn('[households] sync member summary failed:', e);
    }

    const summaryByHousehold = {};
    try {
      for (const hh of h) {
        summaryByHousehold[hh.id] = await fetchHouseholdMemberSummaries(hh.id);
      }
    } catch (e) {
      if (__DEV__ && console?.warn) console.warn('[households] fetch member summaries failed:', e);
    }

    setHouseholds(h);
    setMemberSummaries(summaryByHousehold);
    setInvites(inv);
    setLoading(false);
  }, [uid, email, profile?.displayName, user?.displayName]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCreate = async () => {
    if (!uid) return;
    const n = name.trim() || 'Moja domácnosť';
    setBusy(true);
    try {
      const ownerName = (profile?.displayName || user?.displayName || user?.email || '').trim();
      const hid = await createHousehold(uid, n, ownerName);
      await updateProfile({ activeHouseholdId: hid });
      await refetchProfile();
      setName('');
      Alert.alert('Hotovo', 'Domácnosť bola vytvorená. V záložke Nákup môžeš teraz používať zdieľaný zoznam.');
      await load();
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa vytvoriť domácnosť.');
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async (householdId) => {
    if (!uid) return;
    const em = (inviteEmail[householdId] || '').trim().toLowerCase();
    if (!em) {
      Alert.alert('E-mail', 'Zadaj e-mail pozvaného.');
      return;
    }
    setBusy(true);
    try {
      await createHouseholdInvite(householdId, uid, em);
      setInviteEmail((prev) => ({ ...prev, [householdId]: '' }));
      Alert.alert('Odoslané', 'Pozvánka bola vytvorená. Po prihlásení s týmto e-mailom uvidí pozvánku tu v Domácnosti.');
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa poslať pozvánku.');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (inviteId) => {
    if (!uid || !email) return;
    setBusy(true);
    try {
      const memberName = (profile?.displayName || user?.displayName || user?.email || '').trim();
      await acceptHouseholdInvite(inviteId, uid, email, memberName);
      await load();
      Alert.alert(
        'Pozvánka prijatá',
        'Pozvánka do domácnosti bola prijatá. Si členom domácnosti – môžeš prepnúť nákupný zoznam na zdieľaný.'
      );
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa prijať pozvánku.');
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async (inviteId) => {
    setBusy(true);
    try {
      await declineHouseholdInvite(inviteId);
      await load();
      Alert.alert('Pozvánka odmietnutá', 'Pozvánka do domácnosti bola odmietnutá.');
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa odmietnuť.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteHousehold = (household) => {
    if (!household?.id) return;
    Alert.alert(
      'Vymazať domácnosť?',
      `Domácnosť "${household.name || 'Domácnosť'}" bude odstránená pre všetkých členov.`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Vymazať',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteHousehold(household.id);
              if (activeHouseholdId === household.id) {
                await updateProfile({ activeHouseholdId: null });
                await refetchProfile();
              }
              await load();
              Alert.alert('Hotovo', 'Domácnosť bola odstránená.');
            } catch (e) {
              Alert.alert('Chyba', e?.message || 'Nepodarilo sa odstrániť domácnosť.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const setActiveHousehold = async (hid) => {
    await updateProfile({ activeHouseholdId: hid });
    await refetchProfile();
  };

  const clearActiveHousehold = async () => {
    await updateProfile({ activeHouseholdId: null });
    await refetchProfile();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="people" size={28} color="#FFFFFF" />
        </View>
        <Text style={styles.heroTitle}>Zdieľaná domácnosť</Text>
        <Text style={styles.heroSubtitle}>
          Spoločný nákupný zoznam pre všetkých členov. Pridávajte položky a uvidíte ich v reálnom čase.
        </Text>
      </View>

      <View style={[styles.statusCard, activeHouseholdId ? styles.statusActive : styles.statusInactive]}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusIcon,
              { backgroundColor: activeHouseholdId ? colors.surfaceIndigoLight : colors.surfaceMuted },
            ]}
          >
            <Ionicons
              name={activeHouseholdId ? 'people-circle' : 'person-circle'}
              size={28}
              color={activeHouseholdId ? colors.primary : colors.textMuted}
            />
          </View>
          <View style={styles.statusTextWrap}>
            <Text style={styles.statusLabel}>Aktívny nákupný zoznam</Text>
            <Text style={styles.statusValue}>
              {activeHouseholdId
                ? activeHousehold?.name || 'Zdieľaná domácnosť'
                : 'Osobný zoznam (iba ty)'}
            </Text>
          </View>
        </View>
        {activeHouseholdId ? (
          <TouchableOpacity style={styles.statusBtn} onPress={clearActiveHousehold} activeOpacity={0.85}>
            <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
            <Text style={styles.statusBtnText}>Prepnúť na osobný zoznam</Text>
          </TouchableOpacity>
        ) : households.length > 0 ? (
          households.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={styles.statusBtn}
              onPress={() => setActiveHousehold(h.id)}
              activeOpacity={0.85}
            >
              <Ionicons name="people" size={16} color={colors.primary} />
              <Text style={styles.statusBtnText} numberOfLines={1}>
                Použiť: {h.name || 'Domácnosť'}
              </Text>
            </TouchableOpacity>
          ))
        ) : null}
      </View>

      {invites.length > 0 && (
        <View style={styles.inviteCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconCircle, { backgroundColor: colors.tintWarningSurface }]}>
              <Ionicons name="mail" size={16} color={colors.warning} />
            </View>
            <Text style={styles.sectionTitle}>
              Pozvánky pre teba ({invites.length})
            </Text>
          </View>
          <Text style={styles.inviteEmailLine}>{email}</Text>
          {invites.map((inv) => (
            <View key={inv.id} style={styles.inviteRow}>
              <View style={styles.inviteRowLeft}>
                <Ionicons name="home-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.inviteText}>Pozvánka do domácnosti</Text>
              </View>
              <View style={styles.inviteBtns}>
                <TouchableOpacity
                  style={styles.declineBtn}
                  onPress={() => handleDecline(inv.id)}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  <Text style={styles.declineText}>Odmietnuť</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.acceptBtn}
                  onPress={() => handleAccept(inv.id)}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  <Text style={styles.acceptBtnText}>Prijať</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionIconCircle}>
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
          </View>
          <Text style={styles.sectionTitle}>Vytvoriť novú domácnosť</Text>
        </View>
        <Text style={styles.fieldLabel}>Názov</Text>
        <TextInput
          style={styles.input}
          placeholder="Napr. Byt na Hlavnej"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />
        <TouchableOpacity
          style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
          onPress={handleCreate}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="home" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.primaryBtnText}>Vytvoriť domácnosť</Text>
        </TouchableOpacity>
      </View>

      {households.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconCircle}>
              <Ionicons name="people-outline" size={16} color={colors.primary} />
            </View>
            <Text style={styles.sectionTitle}>Moje domácnosti ({households.length})</Text>
          </View>

          {households.map((h) => {
            const memberCount = (h.memberUids || []).length;
            const isOwner = h.ownerUid === uid;
            return (
              <View key={h.id} style={styles.householdCard}>
                <View style={styles.householdTopRow}>
                  <View style={styles.householdAvatar}>
                    <Text style={styles.householdAvatarText}>
                      {(h.name || 'D').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.householdName} numberOfLines={1}>
                      {h.name || 'Domácnosť'}
                    </Text>
                    <Text style={styles.householdMeta}>
                      {memberCount} {memberCount === 1 ? 'člen' : memberCount < 5 ? 'členovia' : 'členov'}
                    </Text>
                  </View>
                  <View style={styles.householdTopActions}>
                    {activeHouseholdId === h.id && (
                      <View style={styles.activePill}>
                        <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
                        <Text style={styles.activePillText}>Aktívna</Text>
                      </View>
                    )}
                    {isOwner ? (
                      <TouchableOpacity
                        style={[styles.deleteIconBtn, busy && { opacity: 0.5 }]}
                        onPress={() => handleDeleteHousehold(h)}
                        disabled={busy}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        accessibilityLabel="Odstrániť domácnosť"
                        activeOpacity={0.65}
                      >
                        <Ionicons name="close" size={24} color={colors.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                {!!memberCount && (
                  <View style={styles.membersWrap}>
                    <Text style={styles.membersLabel}>Členovia domácnosti</Text>
                    {(h.memberUids || []).map((memberUid) => {
                      const isMe = memberUid === uid;
                      const ownerMark = memberUid === h.ownerUid ? ' (vlastník)' : '';
                      const meMark = isMe ? ' (ty)' : '';
                      const summaries = memberSummaries[h.id] || {};
                      const label = resolveMemberDisplayName(
                        memberUid,
                        h,
                        summaries,
                        uid,
                        profile?.displayName,
                        user?.displayName,
                        email
                      );
                      return (
                        <Text key={memberUid} style={styles.memberItem} numberOfLines={1}>
                          • {label}
                          {ownerMark}
                          {meMark}
                        </Text>
                      );
                    })}
                  </View>
                )}

                <View style={styles.inviteFormRow}>
                  <TextInput
                    style={styles.inviteInput}
                    placeholder="email@priklad.sk"
                    placeholderTextColor={colors.textMuted}
                    value={inviteEmail[h.id] || ''}
                    onChangeText={(t) =>
                      setInviteEmail((prev) => ({ ...prev, [h.id]: t }))
                    }
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.inviteBtn}
                    onPress={() => handleInvite(h.id)}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="paper-plane-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.inviteBtnText}>Pozvať</Text>
                  </TouchableOpacity>
                </View>

              </View>
            );
          })}
        </View>
      )}

      <View style={styles.infoBanner}>
        <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
        <Text style={styles.infoBannerText}>
          Pozvaný používateľ uvidí pozvánku po prihlásení s daným e-mailom v záložke Domácnosť.
        </Text>
      </View>
    </ScrollView>
  );
}

function createHouseholdStyles(colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hero: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.medium,
  },
  heroTitle: {
    ...typography.title,
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  heroSubtitle: {
    ...typography.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },

  statusCard: {
    borderRadius: radius.large,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.small,
  },
  statusActive: { backgroundColor: colors.surfaceIndigo },
  statusInactive: { backgroundColor: colors.backgroundPrimary },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextWrap: { flex: 1 },
  statusLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statusValue: {
    ...typography.title,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.backgroundPrimary,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderIndigo,
  },
  statusBtnText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },

  section: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.small,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tintIndigoSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  fieldLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.medium,
    ...shadows.small,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },

  inviteCard: {
    backgroundColor: colors.warningSurface,
    borderRadius: radius.large,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  inviteEmailLine: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontSize: 12,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.warningRowBorder,
    gap: spacing.sm,
  },
  inviteRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  inviteText: { ...typography.body, fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  inviteBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.small,
  },
  acceptBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  declineBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  declineText: { ...typography.body, fontSize: 13, color: colors.textMuted, fontWeight: '600' },

  householdCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.medium,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  householdTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  householdAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  householdAvatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
  householdName: {
    ...typography.title,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  householdMeta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  householdTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceIndigoLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  deleteIconBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteFormRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inviteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundPrimary,
  },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.small,
  },
  inviteBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  membersWrap: {
    backgroundColor: colors.surfaceIndigo,
    borderRadius: radius.small,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  membersLabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  memberItem: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: 2,
  },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceIndigo,
    borderRadius: radius.medium,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  infoBannerText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 18,
  },
});
}
