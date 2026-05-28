// Prihlásenie e-mailom alebo Google OAuth.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../firebase';
import {
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile as updateAuthProfile,
} from 'firebase/auth';
import { useAppTheme, typography, spacing, radius, shadows } from '../theme';
import Button from '../components/ui/Button';
import GoogleSignInButton, {
  isGoogleOAuthConfigured,
} from '../components/auth/GoogleSignInButton';
import { setProfile as saveProfileToFirestore } from '../services/firestore/profiles';

export default function AuthScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createAuthStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const showGoogleSignIn = isGoogleOAuthConfigured();

  const blob1Y = useRef(new Animated.Value(0)).current;
  const blob2Y = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const guestOpacity = useRef(new Animated.Value(0)).current;
  const legalOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(blob1Y, { toValue: -15, duration: 2500, useNativeDriver: true }),
        Animated.timing(blob1Y, { toValue: 0, duration: 2500, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(blob2Y, { toValue: 15, duration: 3000, useNativeDriver: true }),
        Animated.timing(blob2Y, { toValue: 0, duration: 3000, useNativeDriver: true }),
      ])
    ).start();
  }, [blob1Y, blob2Y]);

  useEffect(() => {
    Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    Animated.timing(cardOpacity, { toValue: 1, duration: 600, delay: 200, useNativeDriver: true }).start();
    Animated.timing(guestOpacity, { toValue: 1, duration: 600, delay: 400, useNativeDriver: true }).start();
    Animated.timing(legalOpacity, { toValue: 1, duration: 600, delay: 600, useNativeDriver: true }).start();
  }, [logoOpacity, cardOpacity, guestOpacity, legalOpacity]);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim() || (isSignUp && !displayName.trim())) {
      setError(isSignUp ? 'Zadaj meno, e-mail a heslo.' : 'Zadaj e-mail a heslo.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const user = cred.user;
        const name = displayName.trim();
        if (name) {
          await updateAuthProfile(user, { displayName: name });
          await saveProfileToFirestore(user.uid, { displayName: name });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      const msg = e.code === 'auth/email-already-in-use'
        ? 'Tento e-mail je už registrovaný. Prihlás sa.'
        : e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
          ? 'Nesprávny e-mail alebo heslo.'
          : e.code === 'auth/weak-password'
            ? 'Heslo musí mať aspoň 6 znakov.'
            : e.message || 'Prihlásenie zlyhalo';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInAnonymously(auth);
    } catch (e) {
      setError(e.message || 'Prihlásenie zlyhalo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.safe}>
      <View style={[styles.gradientLayer, styles.gradientTop]} />
      <View style={[styles.gradientLayer, styles.gradientMid]} />
      <View style={[styles.gradientLayer, styles.gradientBottom]} />

      <Animated.View style={[styles.blob, styles.blob1, { transform: [{ translateY: blob1Y }] }]} />
      <Animated.View style={[styles.blob, styles.blob2, { transform: [{ translateY: blob2Y }] }]} />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: Math.max(insets.top, spacing.lg) + spacing.md },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.header, { opacity: logoOpacity }]}>
            <View style={[styles.logoBox, shadows.colored]}>
              <Ionicons name="restaurant" size={40} color={colors.primary} />
              <View style={styles.logoStar}>
                <Ionicons name="sparkles" size={18} color={colors.accent} />
              </View>
            </View>
            <Text style={styles.appName}>MealBuddy</Text>
            <Text style={styles.tagline}>
              Plánovanie jedál a nákupov s ohľadom na rozpočet
            </Text>
          </Animated.View>

          {/* prihlásenie */}
          <Animated.View style={[styles.cardWrap, { opacity: cardOpacity }]}>
            <View style={[styles.card, shadows.colored]}>
              {isSignUp ? (
                <>
                  <Text style={styles.label}>Meno</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="person-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Tvoje meno"
                      placeholderTextColor={colors.textMuted}
                      value={displayName}
                      onChangeText={setDisplayName}
                      autoCapitalize="words"
                      editable={!loading}
                    />
                  </View>
                </>
              ) : null}
              <Text style={[styles.label, isSignUp ? { marginTop: spacing.md } : undefined]}>E-mail</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="mail-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="meno@priklad.sk"
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>

              <Text style={[styles.label, { marginTop: spacing.lg }]}>Heslo</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  editable={!loading}
                />
              </View>

              {error ? <Text style={styles.errorInCard}>{error}</Text> : null}

              <Button
                title={isSignUp ? 'Registrovať sa' : 'Prihlásiť sa'}
                onPress={handleSubmit}
                variant="primary"
                style={styles.buttonPrimary}
              />
              {showGoogleSignIn ? (
                <GoogleSignInButton
                  style={styles.buttonGoogle}
                  disabled={loading}
                />
              ) : null}

              <View style={styles.signUpRow}>
                <Text style={styles.signUpText}>
                  {isSignUp ? 'Už máš účet? ' : 'Nemáš účet? '}
                </Text>
                <TouchableOpacity
                  onPress={() => setIsSignUp(!isSignUp)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                >
                  <Text style={styles.signUpLink}>
                    {isSignUp ? 'Prihlásiť sa' : 'Registrovať sa'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          <Animated.View style={[styles.guestWrap, { opacity: guestOpacity }]}>
            <Button
              title={loading ? '' : 'Pokračovať ako hosť'}
              onPress={handleGuest}
              variant="outline"
              loading={loading}
              style={styles.buttonOutline}
            />
          </Animated.View>

          <Animated.Text style={[styles.legal, { opacity: legalOpacity }]}>
            Pokračovaním vyjadruješ súhlas s podmienkami používania a ochranou osobných údajov.
          </Animated.Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function createAuthStyles(colors) {
  return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cardPink,
  },
  gradientLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  gradientTop: {
    backgroundColor: colors.cardPink,
    height: '34%',
  },
  gradientMid: {
    backgroundColor: colors.cardBlue,
    top: '34%',
    height: '33%',
  },
  gradientBottom: {
    backgroundColor: colors.cardGreen,
    top: '67%',
    height: '34%',
  },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.4,
  },
  blob1: {
    width: 128,
    height: 128,
    backgroundColor: colors.pastelPurple || colors.cardPurple,
    top: 80,
    right: 40,
  },
  blob2: {
    width: 160,
    height: 160,
    backgroundColor: colors.pastelPeach || colors.cardPeach,
    bottom: 100,
    left: 40,
  },
  container: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: radius.xLarge,
    backgroundColor: colors.backgroundPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    position: 'relative',
  },
  logoStar: {
    position: 'absolute',
    top: -4,
    right: -4,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
  },
  cardWrap: {
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.backgroundPrimary,
    borderRadius: radius.xLarge,
    padding: spacing.xl,
    ...shadows.medium,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.lg,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  buttonPrimary: {
    marginTop: spacing.lg,
  },
  buttonGoogle: {
    marginTop: spacing.md,
  },
  signUpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
    gap: 4,
  },
  signUpText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  signUpLink: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  guestWrap: {
    marginBottom: spacing.md,
  },
  buttonOutline: {},
  legal: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  errorInCard: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.md,
    textAlign: 'left',
  },
  });
}
