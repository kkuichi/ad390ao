// Katalóg receptov, filtre, pridanie do plánu.
import React, { useState, useMemo, useLayoutEffect, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
  Alert,
  Modal,
  Pressable,
  Animated,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Card from '../components/ui/Card';
import { useRecipes } from '../hooks/useRecipes';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfile } from '../hooks/useProfile';
import { usePantry } from '../hooks/usePantry';
import { useRecipeListPrices } from '../hooks/useRecipeListPrices';
import { addRecipeToPlan, getWeekId } from '../services/firestore/plans';
import { RECIPE_CATEGORIES } from '../services/firestore/recipes';
import { buildPantryIndex } from '../services/pricing/pantryIndex';
import { normalizeName, normalizeUnit, convert } from '../services/pricing/normalize';
import { isVegetarianByIngredients } from '../utils/dietary';

// Počet ingrediencií plne pokrytých špajzou (zhoda s recipeCost).
function countFullyCoveredByPantry(ingredients, pantryIndex) {
  if (!ingredients?.length || !pantryIndex || pantryIndex.size === 0) return 0;
  let count = 0;
  for (const ing of ingredients) {
    const name = typeof ing === 'string' ? ing : ing?.name || '';
    if (!name) continue;
    const nameNormalized = normalizeName(name).replace(/\s+/g, '_');
    const unitRaw = (typeof ing === 'object' && ing?.unit) || 'ks';
    const unitNorm = normalizeUnit(unitRaw);
    if (!unitNorm) continue;

    // Rovnaká jednotková logika ako recipeCost / buildPantryIndex.
    const qty = (typeof ing === 'object' && Number(ing?.qty)) || 1;
    let neededQty = qty;
    if (unitRaw === 'kg' && unitNorm === 'g') {
      neededQty = convert(qty, 'kg', 'g');
    } else if (unitRaw === 'l' && unitNorm === 'ml') {
      neededQty = convert(qty, 'l', 'ml');
    } else if (unitRaw === 'polievková lyžica' || unitRaw === 'pl' || unitRaw === 'pl.') {
      neededQty = qty * 15;
    } else if (
      unitRaw === 'čajová lyžica' ||
      unitRaw === 'cl' ||
      unitRaw === 'čl' ||
      unitRaw === 'čl.'
    ) {
      neededQty = qty * 5;
    } else if (unitRaw === 'hrnček' || unitRaw === 'hrnok') {
      neededQty = qty * 250;
    } else if (unitRaw === 'štipka') {
      neededQty = qty * 1;
    }
    if (!(neededQty > 0)) continue;

    const key = `${nameNormalized}_${unitNorm}`;
    const pantryItem = pantryIndex.get(key);
    if (!pantryItem) continue;
    if (pantryItem.qtyBase >= neededQty) count += 1;
  }
  return count;
}

const RECIPE_CARD_HEIGHT_EST = 255;

// RecipeCard mimo screenu kvôli stabilite fotiek pri re-renderi
const RecipeCard = React.memo(function RecipeCard({
  recipe: r,
  livePrice,
  pantryMatchCount,
  onRecipePress,
  isAdding,
  styles,
  colors,
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const [imageFailed, setImageFailed] = useState(false);
  const imageRetryTimerRef = useRef(null);
  const imageUri = typeof r?.imageUrl === 'string' ? r.imageUrl.trim() : '';

  const handlePress = useCallback(() => {
    onRecipePress(r);
  }, [onRecipePress, r]);

  useEffect(() => {
    setImageFailed(false);
    if (imageRetryTimerRef.current) {
      clearTimeout(imageRetryTimerRef.current);
      imageRetryTimerRef.current = null;
    }
  }, [imageUri]);

  useEffect(
    () => () => {
      if (imageRetryTimerRef.current) clearTimeout(imageRetryTimerRef.current);
    },
    []
  );

  const handlePressIn = useCallback(() => {
    Animated.timing(pressScale, {
      toValue: 0.97,
      duration: 90,
      useNativeDriver: true,
    }).start();
  }, [pressScale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(pressScale, {
      toValue: 1,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [pressScale]);

  return (
    <Animated.View style={{ transform: [{ scale: pressScale }] }}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isAdding}
      >
        <View style={styles.recipeCardOuter}>
          <View style={styles.recipeCardSurface}>
            <View style={styles.recipeImageWrap}>
              {imageUri && !imageFailed ? (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.recipeImage}
                  resizeMode="cover"
                  {...(Platform.OS === 'android' ? { renderToHardwareTextureAndroid: true } : {})}
                  onError={() => {
                    setImageFailed(true);
                    if (imageRetryTimerRef.current) clearTimeout(imageRetryTimerRef.current);
                    imageRetryTimerRef.current = setTimeout(() => {
                      imageRetryTimerRef.current = null;
                      setImageFailed(false);
                    }, 2500);
                  }}
                />
              ) : (
                <View style={styles.recipeImagePlaceholder} />
              )}
              {isVegetarianByIngredients(r.ingredients) && (
                <View style={styles.vegBadge}>
                  <Ionicons name="leaf" size={14} color={colors.success} />
                </View>
              )}
              {livePrice != null && (
                <View style={styles.priceBadge}>
                  <Text style={styles.priceBadgeText}>~ {livePrice.toFixed(2)} €/por.</Text>
                </View>
              )}
            </View>
            <View style={styles.recipeCardBody}>
              <Text style={styles.recipeTitle} numberOfLines={2}>
                {r.name}
              </Text>
              {isAdding ? (
                <ActivityIndicator size="small" color={colors.primary} style={styles.recipeAdding} />
              ) : null}
              <View style={styles.recipeMetaRow}>
                {r.servings != null && r.servings > 0 && (
                  <View style={styles.recipeMetaChip}>
                    <Ionicons name="people-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.recipeMetaChipText}>{r.servings} por.</Text>
                  </View>
                )}
                {r.durationMin != null && (
                  <View style={styles.recipeMetaChip}>
                    <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.recipeMetaChipText}>{r.durationMin} min</Text>
                  </View>
                )}
              </View>
              <View style={styles.pantryReserved}>
                {pantryMatchCount > 0 ? (
                  <View style={styles.pantryLine}>
                    <Ionicons name="basket-outline" size={12} color={colors.success} />
                    <Text style={styles.recipePantryBadge}>Používa {pantryMatchCount} zo špajzi</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});


export default function RecipesScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const addToPlanTarget = route.params?.addToPlanTarget;
  const { user } = useAuthUser();
  const uid = user?.uid;
  const { profile } = useProfile(uid);
  const { items: pantryItems } = usePantry(uid);
  // Index špajzy s qty (rovnaký ako v detaile receptu) – aby badge "Používa N zo
  // špajzi" bral do úvahy aj množstvo, nielen samotný názov.
  const pantryIndex = useMemo(() => buildPantryIndex(pantryItems || []), [pantryItems]);
  const justAddedToPlanRef = useRef(false);
  const [category, setCategory] = useState(null);
  const [listScope, setListScope] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingId, setAddingId] = useState(null);
  // Bottom-sheet modal s filtrami. Stavy `category` a `listScope` zostávajú
  // canonical zdroj pravdy (modal ich len ovláda).
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const listScrollY = useRef(new Animated.Value(0)).current;
  const activeFilterCount = (listScope !== 'all' ? 1 : 0) + (category ? 1 : 0);
  const { recipes, loading, refetch } = useRecipes({
    limit: 100,
    category: category || undefined,
    uid,
  });
  const listPrices = useRecipeListPrices(recipes, {
    uid,
    preferredStore: profile?.preferredStore,
  });
  const { colors } = useAppTheme();
  const styles = useMemo(() => createRecipesStyles(colors), [colors]);

  const filteredRecipes = useMemo(() => {
    let list = recipes;
    const favIds = new Set((profile?.favoriteRecipeIds || []).map((x) => String(x)));
    if (listScope === 'favorites') list = list.filter((r) => favIds.has(String(r.id)));
    else if (listScope === 'mine') list = list.filter((r) => r.isUserRecipe && r.authorUid === uid);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const name = (r.name || '').toLowerCase();
      const tags = (r.tags || []).join(' ').toLowerCase();
      const categoriesStr = (r.categories || []).join(' ').toLowerCase();
      return name.includes(q) || tags.includes(q) || categoriesStr.includes(q);
    });
  }, [recipes, searchQuery, listScope, profile?.favoriteRecipeIds, uid]);

  React.useEffect(() => {
    // Prefetch top obrázkov v aktuálnom zozname, aby sa po scrollovaní/vrátení
    // načítali okamžitejšie a menej mizli pri krátkych reconnectoch.
    const urls = (filteredRecipes || [])
      .map((r) => (typeof r?.imageUrl === 'string' ? r.imageUrl.trim() : ''))
      .filter(Boolean)
      .slice(0, 16);
    urls.forEach((u) => {
      Image.prefetch(u).catch(() => {});
    });
  }, [filteredRecipes]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: addToPlanTarget ? 'Vyber recept do plánu' : 'Recepty',
      headerRight: undefined,
    });
  }, [addToPlanTarget, navigation]);

  const showCreateRecipeFab = Boolean(uid && !addToPlanTarget);
  // Spodná hrana obrazovky už je nad tab barom (Tab navigator). Nepridávaj tabBarHeight –
// inak by bol FAB zdvojeným offsetom príliš vysoko. Len jemný odstup od spodného okraja.

  const fabBottom = spacing.xs;
  // Padding zoznamu, aby posledné karty neboli pod FAB (dva kruhy vedľa seba).

  const listPaddingBottom = spacing.xxl + (showCreateRecipeFab ? 56 + spacing.md : 0);
  const fabRight = spacing.sm + insets.right;

  const handleFavoritesFabPress = useCallback(() => {
    setListScope((s) => (s === 'favorites' ? 'all' : 'favorites'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      const target = route.params?.addToPlanTarget;
      if (!justAddedToPlanRef.current || target == null) return;
      const ts = target._ts;
      const isStale = !ts || Date.now() - ts > 2000;
      if (isStale) {
        navigation.setParams({ addToPlanTarget: undefined });
      }
      justAddedToPlanRef.current = false;
    }, [navigation, route.params?.addToPlanTarget])
  );

  const lastRecipesTabRefetchMsRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      // Pri každom focuse volať refetch spôsoboval nové pole receptov ⇒ zbytočné prekreslenia.
      // Obnov zoznam najviac raz za ~15 s; pri zmene kategórie/účtu aj tak prebehne useEffect v useRecipes.
      if (now - lastRecipesTabRefetchMsRef.current < 15_000) return;
      lastRecipesTabRefetchMsRef.current = now;
      refetch();
    }, [refetch])
  );

  useFocusEffect(
    useCallback(() => {
      const requested = route.params?.initialScope;
      if (requested === 'all' || requested === 'favorites' || requested === 'mine') {
        setListScope(requested);
        navigation.setParams({ initialScope: undefined });
      }
    }, [navigation, route.params?.initialScope])
  );

  const handleRecipePress = useCallback(
    async (r) => {
      if (addToPlanTarget && uid) {
        setAddingId(r.id);
        try {
          const ww = getWeekId(new Date(`${addToPlanTarget.date}T00:00:00`));
          await addRecipeToPlan(uid, ww, addToPlanTarget.date, r.id, addToPlanTarget.mealType);
          justAddedToPlanRef.current = true;
          navigation.navigate('Plan');
        } catch (err) {
          Alert.alert('Chyba', err?.message || 'Recept sa nepodarilo pridať do plánu.');
        } finally {
          setAddingId(null);
        }
        return;
      }
      navigation.navigate('RecipeDetail', { recipeId: r.id, initialRecipe: r });
    },
    [addToPlanTarget, uid, navigation]
  );

  return (
    <View style={styles.screenRoot}>
      <Animated.ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: listPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: listScrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      >
      <View style={styles.topBar}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Hľadať recepty…"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={() => setFilterModalVisible(true)}
          activeOpacity={0.85}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={activeFilterCount > 0 ? '#FFFFFF' : colors.textPrimary}
          />
          <Text style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextActive]}>
            Filtre
          </Text>
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeFilterCount > 0 && (
        <View style={styles.activeFilterRow}>
          {listScope !== 'all' && (
            <TouchableOpacity
              style={styles.activeFilterChip}
              onPress={() => setListScope('all')}
              activeOpacity={0.7}
            >
              <Text style={styles.activeFilterText}>
                {listScope === 'favorites' ? 'Obľúbené' : 'Moje'}
              </Text>
              <Ionicons name="close" size={14} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          {category && (
            <TouchableOpacity
              style={styles.activeFilterChip}
              onPress={() => setCategory(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.activeFilterText} numberOfLines={1}>
                {category}
              </Text>
              <Ionicons name="close" size={14} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.clearAllBtn}
            onPress={() => {
              setListScope('all');
              setCategory(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.clearAllText}>Vymazať všetky</Text>
          </TouchableOpacity>
        </View>
      )}
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
      ) : filteredRecipes.length === 0 ? (
        <Card variant="blue" paddingSize="large" style={[styles.emptyCard, shadows.small]}>
          <Text style={styles.emptyText}>
            {recipes.length === 0
              ? 'Zatiaľ žiadne recepty.'
              : listScope === 'favorites'
                ? 'Nemáš žiadne obľúbené recepty.'
                : listScope === 'mine'
                  ? 'Ešte nemáš vlastné recepty.'
                  : 'Žiadny recept nevyhovuje vyhľadávaniu.'}
          </Text>
          <Text style={styles.emptySub}>
            {recipes.length === 0
              ? 'Pridaj recepty do Firestore alebo vlastný recept cez tlačidlo vpravo dole.'
              : listScope === 'favorites'
                ? 'V detaile receptu ťukni na srdce v hlavičke.'
                : listScope === 'mine'
                  ? 'Ťukni na + vpravo dole a vytvor prvý recept.'
                  : 'Skús iný výraz alebo zmeň filter.'}
          </Text>
        </Card>
      ) : (
        <View style={styles.cardGrid}>
          {filteredRecipes.map((r, idx) => {
            const row = Math.floor(idx / 2);
            const cardCenterY = row * RECIPE_CARD_HEIGHT_EST + RECIPE_CARD_HEIGHT_EST / 2;
            const scale = listScrollY.interpolate({
              inputRange: [cardCenterY - RECIPE_CARD_HEIGHT_EST, cardCenterY, cardCenterY + RECIPE_CARD_HEIGHT_EST],
              outputRange: [0.97, 1, 0.97],
              extrapolate: 'clamp',
            });
            const opacity = listScrollY.interpolate({
              inputRange: [cardCenterY - RECIPE_CARD_HEIGHT_EST, cardCenterY, cardCenterY + RECIPE_CARD_HEIGHT_EST],
              outputRange: [0.82, 1, 0.82],
              extrapolate: 'clamp',
            });
            const livePrice =
              typeof listPrices[r.id] === 'number' && listPrices[r.id] > 0 ? listPrices[r.id] : null;
            const pantryMatchCount = countFullyCoveredByPantry(r.ingredients, pantryIndex);
            return (
              <Animated.View key={r.id} style={{ transform: [{ scale }], opacity }}>
                <RecipeCard
                  recipe={r}
                  livePrice={livePrice}
                  pantryMatchCount={pantryMatchCount}
                  onRecipePress={handleRecipePress}
                  isAdding={addingId === r.id}
                  styles={styles}
                  colors={colors}
                />
              </Animated.View>
            );
          })}
        </View>
      )}

      </Animated.ScrollView>

      {showCreateRecipeFab ? (
        <View style={[styles.fabCluster, { bottom: fabBottom, right: fabRight }]}>
          <TouchableOpacity
            style={[
              styles.favoritesQuickFab,
              listScope === 'favorites' && styles.favoritesQuickFabActive,
            ]}
            onPress={handleFavoritesFabPress}
            activeOpacity={0.88}
            accessibilityLabel={
              listScope === 'favorites' ? 'Zobraziť všetky recepty' : 'Obľúbené recepty'
            }
            accessibilityRole="button"
            accessibilityState={{ selected: listScope === 'favorites' }}
          >
            <Ionicons
              name={listScope === 'favorites' ? 'heart' : 'heart-outline'}
              size={26}
              color={listScope === 'favorites' ? '#FFFFFF' : colors.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.createRecipeFab}
            onPress={() => navigation.navigate('CreateRecipe')}
            activeOpacity={0.88}
            accessibilityLabel="Pridať vlastný recept"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={30} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ) : null}

      <FilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        listScope={listScope}
        setListScope={setListScope}
        category={category}
        setCategory={setCategory}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}


function FilterModal({ visible, onClose, listScope, setListScope, category, setCategory, colors, styles }) {
  const [draftScope, setDraftScope] = useState(listScope);
  const [draftCategory, setDraftCategory] = useState(category);

  // Pri otvorení modalu si vždy načítame aktuálny "applied" stav. Pri zatvorení
  // bez Použiť sa draft zahodí.
  React.useEffect(() => {
    if (visible) {
      setDraftScope(listScope);
      setDraftCategory(category);
    }
  }, [visible, listScope, category]);

  const handleApply = () => {
    setListScope(draftScope);
    setCategory(draftCategory);
    onClose();
  };

  const handleReset = () => {
    setDraftScope('all');
    setDraftCategory(null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <Pressable style={styles.sheetContent} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderLeft}>
              <Ionicons name="options-outline" size={22} color={colors.textPrimary} />
              <Text style={styles.sheetTitle}>Filtre</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetSectionLabel}>Zobrazenie</Text>
            <View style={styles.scopeRow}>
              {[
                { id: 'all', label: 'Všetky' },
                { id: 'favorites', label: 'Obľúbené' },
                { id: 'mine', label: 'Moje' },
              ].map((opt) => {
                const active = draftScope === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[styles.scopeOption, active && styles.scopeOptionActive]}
                    onPress={() => setDraftScope(opt.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.scopeOptionText, active && styles.scopeOptionTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sheetSectionLabel}>Typ jedla / kategória</Text>
            <View style={styles.categoryGrid}>
              <TouchableOpacity
                style={[styles.sheetChip, !draftCategory && styles.sheetChipActive]}
                onPress={() => setDraftCategory(null)}
                activeOpacity={0.85}
              >
                <Text style={[styles.sheetChipText, !draftCategory && styles.sheetChipTextActive]}>
                  Všetky
                </Text>
              </TouchableOpacity>
              {RECIPE_CATEGORIES.map((label) => {
                const active = draftCategory === label;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[styles.sheetChip, active && styles.sheetChipActive]}
                    onPress={() => setDraftCategory(label)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.sheetChipText, active && styles.sheetChipTextActive]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.sheetFooter}>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.7}>
              <Text style={styles.resetBtnText}>Vynulovať</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={handleApply} activeOpacity={0.85}>
              <Text style={styles.applyBtnText}>Použiť</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createRecipesStyles(colors) {
  return StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  fabCluster: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 20,
    elevation: 10,
  },
  favoritesQuickFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 107, 157, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
  },
  favoritesQuickFabActive: {
    backgroundColor: 'rgba(255, 107, 157, 0.9)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  createRecipeFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 107, 157, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B9D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 12,
  },
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: spacing.md,
  },
  searchIcon: { marginRight: spacing.xs },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 44,
    ...shadows.small,
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterBtnText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  filterBtnTextActive: { color: '#FFFFFF' },
  filterBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  activeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.backgroundPrimary,
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: 200,
  },
  activeFilterText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  clearAllBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  clearAllText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  loader: { marginVertical: spacing.xl },
  emptyCard: { marginBottom: spacing.lg },
  emptyText: { ...typography.body, color: colors.textMuted },
  emptySub: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  recipeCardOuter: {
    width: (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm) / 2,
    marginBottom: spacing.lg,
    borderRadius: radius.large,
    ...shadows.medium,
  },
  recipeCardSurface: {
    borderRadius: radius.large,
    backgroundColor: colors.cardBlue,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  recipeImageWrap: { position: 'relative' },
  recipeImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.backgroundSecondary,
  },
  recipeImagePlaceholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.backgroundSecondary,
  },
  recipeCardBody: {
    padding: spacing.md,
    minHeight: 128,
    justifyContent: 'flex-start',
  },
  vegBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  priceBadgeText: {
    ...typography.caption,
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  recipeTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 40,
  },
  recipeAdding: { marginTop: spacing.xs },
  recipeMetaRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
    alignItems: 'center',
    minHeight: 24,
  },
  recipeMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 3,
    borderRadius: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  recipeMetaChipText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  pantryReserved: {
    marginTop: spacing.sm,
    minHeight: 26,
    justifyContent: 'center',
  },
  pantryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recipePantryBadge: {
    ...typography.caption,
    color: colors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  recipeMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, fontSize: 12 },
  skeletonPrice: { color: colors.textMuted },
  skeletonText: { opacity: 0.3 },

  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    backgroundColor: colors.backgroundPrimary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sheetTitle: {
    ...typography.title,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sheetBody: {
    paddingTop: spacing.lg,
  },
  sheetSectionLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  scopeRow: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.medium,
    padding: 4,
    marginBottom: spacing.lg,
  },
  scopeOption: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.small,
    alignItems: 'center',
  },
  scopeOptionActive: {
    backgroundColor: colors.backgroundPrimary,
    ...shadows.small,
  },
  scopeOptionText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  scopeOptionTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sheetChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sheetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sheetChipText: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sheetChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  resetBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
  },
  resetBtnText: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  applyBtn: {
    flex: 2,
    paddingVertical: spacing.md,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    alignItems: 'center',
    ...shadows.small,
  },
  applyBtnText: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
}
