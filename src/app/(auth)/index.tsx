import { ScreenFrame } from "@/components/ScreenFrame";
import { colors, fonts } from "@/constants/theme";

import { useAuth, useSSO, useSignIn, useSignUp } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

WebBrowser.maybeCompleteAuthSession();

type Mode = "login" | "signup";
type Step = "form" | "verify";
type VerificationPurpose = "signup" | "login";

function getErrorMessage(error: any, fallback: string): string {
  return (
    error?.errors?.[0]?.longMessage ??
    error?.errors?.[0]?.message ??
    error?.longMessage ??
    error?.message ??
    fallback
  );
}

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { isLoaded, isSignedIn } = useAuth();

  const {
    signIn,
    errors: signInErrors,
    fetchStatus: signInFetch,
  } = useSignIn();

  const {
    signUp,
    errors: signUpErrors,
    fetchStatus: signUpFetch,
  } = useSignUp();

  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");
  const [verificationPurpose, setVerificationPurpose] =
    useState<VerificationPurpose>("signup");

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const busy =
    signInFetch === "fetching" || signUpFetch === "fetching" || googleBusy;

  const errors = mode === "login" ? signInErrors : signUpErrors;

  // errors is a union of SignInFields | SignUpFields, so widen it before
  // reading keys that only exist on one of the two.
  const fieldErrors = (errors?.fields ?? {}) as unknown as Record<
    string,
    { message?: string } | null | undefined
  >;

  const apiError: string | null =
    fieldErrors.code?.message ??
    fieldErrors.emailAddress?.message ??
    fieldErrors.identifier?.message ??
    fieldErrors.username?.message ??
    fieldErrors.password?.message ??
    errors?.global?.[0]?.message ??
    null;

  const message = localError ?? apiError;

  // FIX 1: if a session already exists, skip this screen entirely
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace("/(app)");
    }
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    void WebBrowser.warmUpAsync();

    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const navigate = async ({ session }: { session: any }) => {
    if (session?.currentTask) {
      setLocalError(
        `Your account needs one more step before you can continue (${
          session.currentTask.key ?? "pending task"
        }).`
      );
      return;
    }

    router.replace("/(app)");
  };

  const clearMessages = () => {
    setLocalError(null);
    setNotice(null);
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setStep("form");
    setVerificationPurpose("signup");
    setCode("");
    clearMessages();
  };

  // GOOGLE SIGN-IN
  const handleGoogleSignIn = async () => {
    if (busy) return;

    clearMessages();

    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      setLocalError("Google sign-in needs a development build, not Expo Go.");
      return;
    }

    setGoogleBusy(true);

    try {
      const redirectUrl = AuthSession.makeRedirectUri();

      const {
        createdSessionId,
        setActive,
        signUp: ssoSignUp,
      } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl,
      });

      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace("/(app)");
      } else {
        // FIX 3: surface what Clerk is still missing (e.g. username)
        const missing = (ssoSignUp as any)?.missingFields as
          | string[]
          | undefined;

        setLocalError(
          missing?.length
            ? `Google sign-in needs more info: ${missing.join(
                ", "
              )}. Make these optional in the Clerk dashboard, or collect them after sign-in.`
            : "Google sign-in did not finish. Check your Clerk OAuth configuration and redirect URL allowlist."
        );
      }
    } catch (error: unknown) {
      setLocalError(getErrorMessage(error, "Google sign-in failed."));
    } finally {
      setGoogleBusy(false);
    }
  };

  // EMAIL + PASSWORD LOGIN
  const handleLogin = async () => {
    const emailAddress = email.trim().toLowerCase();

    if (!emailAddress || !password) {
      setLocalError("Enter your email address and password.");
      return;
    }

    try {
      const { error } = await signIn.password({
        emailAddress,
        password,
      });

      if (error) {
        setLocalError(getErrorMessage(error, "Login failed."));
        return;
      }

      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize({
          navigate,
        });

        if (finalizeError) {
          setLocalError(
            getErrorMessage(finalizeError, "Could not finish login.")
          );
        }
        return;
      }

      if (signIn.status === "needs_client_trust") {
        const emailFactor = signIn.supportedSecondFactors?.find(
          (factor: any) => factor.strategy === "email_code"
        );

        if (emailFactor) {
          const { error: sendError } = await signIn.mfa.sendEmailCode();

          if (sendError) {
            setLocalError(
              getErrorMessage(
                sendError,
                "Could not send the verification code."
              )
            );
            return;
          }

          setVerificationPurpose("login");
          setStep("verify");
          setNotice("Check your email for a verification code.");
          return;
        }
      }

      // FIX 4: show the real status so dead-ends are debuggable
      setLocalError(`Sign-in not complete (status: ${signIn.status}).`);
    } catch (error: unknown) {
      setLocalError(getErrorMessage(error, "Login failed."));
    }
  };

  // CREATE ACCOUNT
  const handleSignUp = async () => {
    const cleanUsername = username.trim().toLowerCase();
    const emailAddress = email.trim().toLowerCase();

    if (
      cleanUsername.length < 3 ||
      !emailAddress.includes("@") ||
      password.length < 8
    ) {
      setLocalError(
        "Enter a username with at least 3 characters, a valid email, and a password with at least 8 characters."
      );
      return;
    }

    try {
      const { error } = await signUp.password({
        emailAddress,
        username: cleanUsername,
        password,
      });

      if (error) {
        setLocalError(getErrorMessage(error, "Sign up failed."));
        return;
      }

      const { error: sendError } = await signUp.verifications.sendEmailCode();

      if (sendError) {
        setLocalError(
          getErrorMessage(sendError, "Could not send the email code.")
        );
        return;
      }

      setVerificationPurpose("signup");
      setStep("verify");
      setNotice(`A verification code was sent to ${emailAddress}.`);
    } catch (error: unknown) {
      setLocalError(getErrorMessage(error, "Sign up failed."));
    }
  };

  // VERIFY EMAIL OR DEVICE TRUST
  const handleVerify = async () => {
    const verificationCode = code.trim();

    if (!/^\d{6}$/.test(verificationCode)) {
      setLocalError("Enter the 6-digit verification code.");
      return;
    }

    try {
      if (verificationPurpose === "signup") {
        const { error } = await signUp.verifications.verifyEmailCode({
          code: verificationCode,
        });

        if (error) {
          setLocalError(getErrorMessage(error, "Invalid verification code."));
          return;
        }

        if (signUp.status === "complete") {
          const { error: finalizeError } = await signUp.finalize({ navigate });

          if (finalizeError) {
            setLocalError(
              getErrorMessage(
                finalizeError,
                "Could not finish creating your account."
              )
            );
          }
        } else {
          // FIX 2: say exactly what Clerk still needs
          setLocalError(
            `Email verified, but Clerk still needs: ${
              (signUp as any).missingFields?.join(", ") || signUp.status
            }.`
          );
        }

        return;
      }

      const { error } = await signIn.mfa.verifyEmailCode({
        code: verificationCode,
      });

      if (error) {
        setLocalError(getErrorMessage(error, "Invalid verification code."));
        return;
      }

      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize({
          navigate,
        });

        if (finalizeError) {
          setLocalError(
            getErrorMessage(finalizeError, "Could not finish login.")
          );
        }
      } else {
        setLocalError(
          `Verification incomplete (status: ${signIn.status}). Please try again.`
        );
      }
    } catch (error: unknown) {
      setLocalError(getErrorMessage(error, "Verification failed."));
    }
  };

  // RESEND VERIFICATION CODE
  const handleResend = async () => {
    if (busy) return;

    clearMessages();

    try {
      if (verificationPurpose === "signup") {
        const { error } = await signUp.verifications.sendEmailCode();

        if (error) {
          setLocalError(getErrorMessage(error, "Could not resend the code."));
          return;
        }
      } else {
        const { error } = await signIn.mfa.sendEmailCode();

        if (error) {
          setLocalError(getErrorMessage(error, "Could not resend the code."));
          return;
        }
      }

      setNotice("A new verification code has been sent.");
    } catch (error: unknown) {
      setLocalError(getErrorMessage(error, "Could not resend the code."));
    }
  };

  const handleSubmit = () => {
    if (busy) return;

    clearMessages();

    if (step === "verify") {
      void handleVerify();
    } else if (mode === "login") {
      void handleLogin();
    } else {
      void handleSignUp();
    }
  };

  const buttonLabel = busy
    ? "PLEASE WAIT..."
    : step === "verify"
    ? "VERIFY →"
    : mode === "login"
    ? "ENTER →"
    : "CREATE →";

  return (
    <ScreenFrame>
      <Image
        source={require("../../../assets/images/logo.png")}
        style={[styles.logo, { top: insets.top + 6 }]}
        resizeMode="contain"
      />

      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.box}>
          <View style={styles.tabs}>
            <Tab
              label="LOGIN"
              active={mode === "login"}
              onPress={() => switchMode("login")}
            />

            <Tab
              label="SIGN UP"
              active={mode === "signup"}
              onPress={() => switchMode("signup")}
            />
          </View>

          <View style={styles.panel}>
            {step === "verify" ? (
              <>
                <Text style={styles.hint}>
                  {verificationPurpose === "signup"
                    ? "Check your email for a 6-digit verification code."
                    : "Verify this sign-in using the code sent to your email."}
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>CODE:</Text>

                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={(value) =>
                      setCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    keyboardType="number-pad"
                    maxLength={6}
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                    editable={!busy}
                    accessibilityLabel="Verification code"
                  />
                </View>
              </>
            ) : (
              <>
                {mode === "signup" && (
                  <View style={styles.row}>
                    <Text style={styles.label}>USERNAME:</Text>

                    <TextInput
                      style={styles.input}
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      textContentType="username"
                      returnKeyType="next"
                      onSubmitEditing={() => emailRef.current?.focus()}
                      blurOnSubmit={false}
                      editable={!busy}
                      accessibilityLabel="Username"
                    />
                  </View>
                )}

                <View style={styles.row}>
                  <Text style={styles.label}>EMAIL:</Text>

                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoComplete="email"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!busy}
                    accessibilityLabel="Email address"
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>PASSWORD:</Text>

                  <TextInput
                    ref={passwordRef}
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType={
                      mode === "login" ? "password" : "newPassword"
                    }
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                    editable={!busy}
                    accessibilityLabel="Password"
                  />
                </View>
              </>
            )}

            {message ? (
              <Text style={styles.error}>{message}</Text>
            ) : notice ? (
              <Text style={styles.hint}>{notice}</Text>
            ) : null}

            <View style={styles.actions}>
              {step === "verify" ? (
                <View style={styles.secondaryActions}>
                  <Pressable
                    onPress={() => void handleResend()}
                    disabled={busy}
                    hitSlop={8}
                  >
                    <Text style={styles.link}>RESEND</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setStep("form");
                      setCode("");
                      clearMessages();
                    }}
                    disabled={busy}
                    hitSlop={8}
                  >
                    <Text style={styles.link}>BACK</Text>
                  </Pressable>
                </View>
              ) : (
                <View />
              )}

              <Pressable
                onPress={handleSubmit}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={[styles.enterText, busy && styles.disabledText]}>
                  {buttonLabel}
                </Text>
              </Pressable>
            </View>

            {busy && <ActivityIndicator size="small" color={colors.ink} />}
          </View>
        </View>

        <Pressable
          onPress={() => void handleGoogleSignIn()}
          disabled={busy}
          style={styles.google}
          accessibilityRole="button"
        >
          <View style={styles.googleInner}>
            <Text style={styles.googleText}>CONTINUE WITH GOOGLE</Text>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </ScreenFrame>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabText, active && styles.tabActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  logo: {
    position: "absolute",
    left: 14,
    width: 62,
    height: 46,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingBottom: 60,
  },

  box: {
    width: "72%",
    minWidth: 290,
    maxWidth: 380,
    backgroundColor: colors.box,
    padding: 7,
  },

  tabs: {
    flexDirection: "row",
    gap: 7,
  },

  tab: {
    flex: 1,
    backgroundColor: colors.white,
    paddingVertical: 14,
    alignItems: "center",
  },

  tabText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    color: colors.ink,
  },

  tabActive: {
    textDecorationLine: "underline",
  },

  panel: {
    backgroundColor: colors.white,
    marginTop: 7,
    padding: 20,
    gap: 24,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-end",
  },

  label: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: colors.ink,
  },

  input: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
    paddingVertical: 0,
    paddingBottom: 1,
    borderBottomWidth: 2,
    borderColor: colors.ink,
    fontFamily: fonts.body,
    fontSize: 15,
    letterSpacing: 1,
    color: colors.ink,
  },

  google: {
    width: "72%",
    minWidth: 290,
    maxWidth: 380,
    backgroundColor: colors.box,
    padding: 7,
    marginTop: 14,
  },

  googleInner: {
    backgroundColor: colors.white,
    paddingVertical: 14,
    alignItems: "center",
  },

  googleText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2,
    color: colors.ink,
  },

  hint: {
    fontFamily: fonts.body,
    color: colors.quote,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.5,
  },

  error: {
    color: colors.error,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
  },

  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  secondaryActions: {
    flexDirection: "row",
    alignItems: "center",
  },

  link: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: colors.quote,
    marginRight: 16,
  },

  enterText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    color: colors.ink,
  },

  disabledText: {
    opacity: 0.5,
  },
});
