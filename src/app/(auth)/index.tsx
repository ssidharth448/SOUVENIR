import { useState } from 'react'
import {
  Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSignIn, useSignUp } from '@clerk/expo'
import { ScreenFrame } from '@/components/ScreenFrame'
import { colors, fonts } from '@/constants/theme'

type Mode = 'login' | 'signup'

export default function AuthScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { signIn, errors: signInErrors, fetchStatus: signInFetch } = useSignIn()
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetch } = useSignUp()

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const busy = signInFetch === 'fetching' || signUpFetch === 'fetching'
  const errs: any = mode === 'login' ? signInErrors : signUpErrors
  const apiError: string | null =
    errs?.fields?.identifier?.message ??
    errs?.fields?.username?.message ??
    errs?.fields?.password?.message ??
    errs?.global?.[0]?.message ??
    null
  const message = localError ?? apiError

  // Called once Clerk has created the session. The (auth) layout also
  // redirects signed-in users, so this is just a fast path.
  const navigate = async ({ session }: { session: any }) => {
    if (session?.currentTask) {
      console.log('Clerk session task pending:', session.currentTask)
      return
    }
    router.replace('/(app)')
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setLocalError(null)
  }

  const submit = async () => {
    setLocalError(null)
    const u = username.trim().toLowerCase()

    if (mode === 'signup' && (u.length < 3 || password.length < 8)) {
      setLocalError('Username: 3+ characters. Password: 8+ characters.')
      return
    }
    if (!u || !password) {
      setLocalError('Enter your username and password.')
      return
    }

    if (mode === 'login') {
      await signIn.password({ username: u, password })
      if (signIn.status === 'complete') {
        await signIn.finalize({ navigate })
      } else if (signIn.status === 'needs_client_trust') {
        setLocalError('Clerk "Device Trust" is on. Turn it off in the Clerk dashboard.')
      }
    } else {
      await signUp.password({ username: u, password })
      if (signUp.status === 'complete') {
        await signUp.finalize({ navigate })
      } else if (signUp.status === 'missing_requirements') {
        setLocalError('Clerk needs more info. Turn email off in User & authentication.')
      }
    }
  }

  return (
    <ScreenFrame>
      <Image
        source={require('../../../assets/images/logo.png')}
        style={[styles.logo, { top: insets.top + 6 }]}
        resizeMode="contain"
      />

      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.box}>
          <View style={styles.tabs}>
            <Tab label="LOGIN" active={mode === 'login'} onPress={() => switchMode('login')} />
            <Tab label="SIGN UP" active={mode === 'signup'} onPress={() => switchMode('signup')} />
          </View>

          <View style={styles.panel}>
            <View style={styles.row}>
              <Text style={styles.label}>USERNAME:</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                returnKeyType="next"
              />
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>PASSWORD:</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType={mode === 'login' ? 'password' : 'newPassword'}
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            </View>

            {message ? <Text style={styles.error}>{message}</Text> : null}

            {/* Not in the Figma frame: needed so the form can be submitted. */}
            <Pressable onPress={submit} disabled={busy} style={styles.enter}>
              <Text style={styles.enterText}>{busy ? '...' : mode === 'login' ? 'ENTER →' : 'CREATE →'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenFrame>
  )
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabText, active && styles.tabActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  logo: { position: 'absolute', left: 14, width: 62, height: 46 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  box: { width: '72%', minWidth: 290, maxWidth: 380, backgroundColor: colors.box, padding: 7 },
  tabs: { flexDirection: 'row', gap: 7 },
  tab: { flex: 1, backgroundColor: colors.white, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', letterSpacing: 2, color: colors.ink },
  tabActive: { textDecorationLine: 'underline' },
  panel: { backgroundColor: colors.white, marginTop: 7, padding: 20, gap: 24 },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  label: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', letterSpacing: 1.6, color: colors.ink },
  input: {
    flex: 1, marginLeft: 8, paddingVertical: 0, paddingBottom: 1,
    borderBottomWidth: 2, borderColor: colors.ink,
    fontFamily: fonts.body, fontSize: 15, letterSpacing: 1, color: colors.ink,
  },
  error: { color: colors.error, fontSize: 12, lineHeight: 17 },
  enter: { alignSelf: 'flex-end' },
  enterText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', letterSpacing: 2, color: colors.ink },
})
