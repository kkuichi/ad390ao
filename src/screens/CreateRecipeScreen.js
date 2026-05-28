// Vytvorenie / úprava vlastného receptu (+ foto do Storage).
import React, { useState, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import { useAuthUser } from '../hooks/useAuthUser';
import { getRecipe, createUserRecipe, updateUserRecipe, RECIPE_CATEGORIES } from '../services/firestore/recipes';
import { uploadRecipeImage } from '../services/storage/recipeImages';

function emptyIngredient() {
  return { name: '', qty: '1', unit: 'ks' };
}

export default function CreateRecipeScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const recipeId = route.params?.recipeId;
  const { user, loading: authLoading } = useAuthUser();
  const uid = user?.uid;
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createCreateRecipeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(!!recipeId);
  const [name, setName] = useState('');
  const [servings, setServings] = useState('4');
  const [durationMin, setDurationMin] = useState('');
  const [category, setCategory] = useState('Vlastné');
  const [ingredients, setIngredients] = useState([emptyIngredient()]);
  const [stepsText, setStepsText] = useState('');
  const [saving, setSaving] = useState(false);
  // imageUrl = uložená URL, localImageUri = nová fotka pred uploadom
  const [imageUrl, setImageUrl] = useState(null);
  const [localImageUri, setLocalImageUri] = useState(null);

  useEffect(() => {
    if (!recipeId) {
      setLoading(false);
      return;
    }
    if (authLoading || !uid) return;
    let cancelled = false;
    getRecipe(recipeId).then((r) => {
      if (cancelled || !r) {
        setLoading(false);
        return;
      }
      if (r.authorUid && r.authorUid !== uid) {
        Alert.alert('Prístup', 'Tento recept nemôžeš upravovať.');
        navigation.goBack();
        return;
      }
      setName(r.name || '');
      setServings(String(r.servings ?? 4));
      setDurationMin(r.durationMin != null ? String(r.durationMin) : '');
      const cats = r.categories || [];
      setCategory(cats[0] && RECIPE_CATEGORIES.includes(cats[0]) ? cats[0] : 'Vlastné');
      const ings = (r.ingredients || []).map((ing) =>
        typeof ing === 'string'
          ? { name: ing, qty: '1', unit: 'ks' }
          : { name: ing.name || '', qty: String(ing.qty ?? 1), unit: ing.unit || 'ks' }
      );
      setIngredients(ings.length ? ings : [emptyIngredient()]);
      setStepsText((r.steps || []).join('\n'));
      setImageUrl(r.imageUrl || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [recipeId, uid, authLoading, navigation]);

  const setIng = (i, field, val) => {
    setIngredients((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  };

  const addIng = () => setIngredients((p) => [...p, emptyIngredient()]);
  const removeIng = (i) => setIngredients((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)));

  const pickImage = async (source) => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Prístup', 'Aby si mohla použiť kameru, povoľ aplikácii prístup v nastaveniach.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.7,
        });
        if (!result.canceled && result.assets?.[0]?.uri) {
          setLocalImageUri(result.assets[0].uri);
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Prístup', 'Aby si mohla vybrať fotku, povoľ aplikácii prístup ku galérii.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.7,
        });
        if (!result.canceled && result.assets?.[0]?.uri) {
          setLocalImageUri(result.assets[0].uri);
        }
      }
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Nepodarilo sa otvoriť výber obrázka.');
    }
  };

  const promptPickImage = () => {
    Alert.alert(
      'Pridať fotku',
      'Vyber zdroj obrázka.',
      [
        { text: 'Galéria', onPress: () => pickImage('library') },
        { text: 'Fotoaparát', onPress: () => pickImage('camera') },
        { text: 'Zrušiť', style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  const removeImage = () => {
    setLocalImageUri(null);
    setImageUrl(null);
  };

  const previewUri = localImageUri || imageUrl;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: recipeId ? 'Upraviť recept' : 'Nový recept',
    });
  }, [navigation, recipeId]);

  const handleSave = async () => {
    if (!uid) return;
    const n = name.trim();
    if (!n) {
      Alert.alert('Názov', 'Zadaj názov receptu.');
      return;
    }
    const ings = ingredients
      .map((x) => ({
        name: x.name.trim(),
        qty: parseFloat(String(x.qty).replace(',', '.')) || 1,
        unit: (x.unit || 'ks').trim(),
      }))
      .filter((x) => x.name);
    if (ings.length === 0) {
      Alert.alert('Ingrediencie', 'Pridaj aspoň jednu ingredienciu s názvom.');
      return;
    }
    const steps = stepsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      let nextImageUrl = imageUrl;
      if (localImageUri) {
        try {
          const { url } = await uploadRecipeImage(uid, localImageUri);
          nextImageUrl = url;
        } catch (uploadErr) {
          Alert.alert(
            'Obrázok',
            uploadErr?.message || 'Obrázok sa nepodarilo nahrať. Skús znova.',
          );
          setSaving(false);
          return;
        }
      }

      const payload = {
        name: n,
        servings: Math.max(1, parseInt(servings, 10) || 4),
        durationMin: durationMin.trim() ? parseInt(durationMin, 10) : null,
        ingredients: ings,
        steps,
        categories: [category],
        // imageUrl explicitne aj ako null, aby sme pri odstránení obrázka
        // zmazali pole na receptu (sanitizeForFirestore zachová null).
        imageUrl: nextImageUrl ?? null,
      };

      if (recipeId) {
        await updateUserRecipe(uid, recipeId, payload);
        Alert.alert('Uložené', 'Recept bol aktualizovaný.');
      } else {
        const id = await createUserRecipe(uid, payload);
        Alert.alert('Uložené', 'Recept bol pridaný.');
        navigation.replace('RecipeDetail', { recipeId: id });
        return;
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('Chyba', e?.message || 'Uloženie zlyhalo.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* fotka receptu */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={promptPickImage}
          style={styles.hero}
        >
          {previewUri ? (
            <>
              <Image source={{ uri: previewUri }} style={styles.heroImage} resizeMode="cover" />
              <View style={styles.heroOverlay} />
              <View style={styles.heroEditBtn}>
                <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
              </View>
            </>
          ) : (
            <View style={styles.heroPlaceholder}>
              <View style={styles.heroIconCircle}>
                <Ionicons name="camera" size={32} color={colors.primary} />
              </View>
              <Text style={styles.heroPlaceholderText}>Pridať fotku receptu</Text>
              <Text style={styles.heroPlaceholderHint}>Galéria alebo fotoaparát</Text>
            </View>
          )}
        </TouchableOpacity>
        {previewUri && (
          <View style={styles.heroActionsRow}>
            <TouchableOpacity onPress={promptPickImage} hitSlop={8} style={styles.heroActionBtn}>
              <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
              <Text style={styles.heroActionText}>Zmeniť</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={removeImage} hitSlop={8} style={styles.heroActionBtn}>
              <Ionicons name="trash-outline" size={14} color={colors.error} />
              <Text style={[styles.heroActionText, { color: colors.error }]}>Odstrániť</Text>
            </TouchableOpacity>
          </View>
        )}

        <Section icon="restaurant-outline" title="Základné údaje" styles={styles} colors={colors}>
          <Text style={styles.fieldLabel}>Názov receptu</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Napr. Babičkine halušky"
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.row}>
            <View style={styles.half}>
              <Text style={styles.fieldLabel}>Porcie</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="people-outline" size={16} color={colors.textMuted} />
                <TextInput
                  style={styles.inputInline}
                  value={servings}
                  onChangeText={setServings}
                  keyboardType="number-pad"
                  placeholder="4"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>
            <View style={styles.half}>
              <Text style={styles.fieldLabel}>Čas (min)</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                <TextInput
                  style={styles.inputInline}
                  value={durationMin}
                  onChangeText={setDurationMin}
                  keyboardType="number-pad"
                  placeholder="voliteľné"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>
          </View>
        </Section>

        <Section icon="pricetags-outline" title="Kategória" styles={styles} colors={colors}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catScrollContent}>
            {RECIPE_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, category === c && styles.chipOn]}
                onPress={() => setCategory(c)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Section>

        <Section icon="basket-outline" title="Ingrediencie" subtitle={`${ingredients.length} položiek`} styles={styles} colors={colors}>
          {ingredients.map((ing, i) => (
            <View key={i} style={styles.ingCard}>
              <TextInput
                style={styles.ingNameInput}
                placeholder="Napr. múka"
                placeholderTextColor={colors.textMuted}
                value={ing.name}
                onChangeText={(t) => setIng(i, 'name', t)}
              />
              <View style={styles.ingMetaRow}>
                <TextInput
                  style={styles.ingQtyInput}
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  value={ing.qty}
                  onChangeText={(t) => setIng(i, 'qty', t)}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={styles.ingUnitInput}
                  placeholder="ks"
                  placeholderTextColor={colors.textMuted}
                  value={ing.unit}
                  onChangeText={(t) => setIng(i, 'unit', t)}
                />
                <TouchableOpacity
                  onPress={() => removeIng(i)}
                  hitSlop={8}
                  style={styles.ingRemoveBtn}
                  disabled={ingredients.length <= 1}
                >
                  <Ionicons
                    name="close-circle"
                    size={22}
                    color={colors.textMuted}
                    style={{ opacity: ingredients.length <= 1 ? 0.3 : 1 }}
                  />
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={addIng} style={styles.addIngBtn} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.addIngText}>Pridať ingredienciu</Text>
          </TouchableOpacity>
        </Section>

        <Section icon="list-outline" title="Postup" subtitle="každý krok na nový riadok" styles={styles} colors={colors}>
          <TextInput
            style={[styles.input, styles.steps]}
            value={stepsText}
            onChangeText={setStepsText}
            multiline
            placeholder="1. Cesto vypracuj a nechaj odpočinúť 30 minút.&#10;2. Halušky vyhadzuj do vriacej osolenej vody.&#10;3. …"
            placeholderTextColor={colors.textMuted}
          />
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="checkmark" size={20} color="#FFFFFF" />
          )}
          <Text style={styles.saveBtnText}>
            {saving ? 'Ukladám…' : recipeId ? 'Uložiť zmeny' : 'Uložiť recept'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Section({ icon, title, subtitle, children, styles, colors }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={styles.sectionIconCircle}>
            <Ionicons name={icon} size={16} color={colors.primary} />
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      <View>{children}</View>
    </View>
  );
}

function createCreateRecipeStyles(colors, isDark) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  scrollFlex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 120 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hero: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: radius.large,
    overflow: 'hidden',
    backgroundColor: colors.cardBlue,
    marginBottom: spacing.sm,
    position: 'relative',
  },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: isDark ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.06)',
  },
  heroEditBtn: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderDefault,
    backgroundColor: colors.surfaceRaised,
  },
  heroIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    ...shadows.small,
  },
  heroPlaceholderText: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  heroPlaceholderHint: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  heroActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  heroActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  heroActionText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 13 },

  section: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.large,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
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
  sectionTitle: {
    ...typography.title,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },

  fieldLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: spacing.sm,
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
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  inputInline: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },

  catScrollContent: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.body, fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  chipTextOn: { color: '#FFFFFF', fontWeight: '700' },

  ingCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.medium,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  ingNameInput: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
  },
  ingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  ingQtyInput: {
    width: 70,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  ingUnitInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    fontSize: 14,
    color: colors.textPrimary,
  },
  ingRemoveBtn: { padding: 4 },
  addIngBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  addIngText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },

  steps: { minHeight: 140, textAlignVertical: 'top' },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    backgroundColor: colors.backgroundPrimary,
    borderTopWidth: 1,
    borderTopColor: colors.borderDefault,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.medium,
    ...shadows.small,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
}
