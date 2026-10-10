import { useEffect, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '@clerk/expo'
import { colors } from '@/constants/theme'

const MIN_SPLASH_MS = 2200

export default function Splash() {
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()
  const [timeUp, setTimeUp] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setTimeUp(true), MIN_SPLASH_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (isLoaded && timeUp) router.replace(isSignedIn ? '/(app)' : '/(auth)')
  }, [isLoaded, timeUp, isSignedIn])

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/splash.png')}
        style={styles.image}
        resizeMode="cover"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.frame },
  image: { width: '100%', height: '100%' },
})
