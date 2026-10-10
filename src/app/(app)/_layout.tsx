import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@clerk/expo'

export default function AppLayout() {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return null
  if (!isSignedIn) return <Redirect href="/(auth)" />
  return <Stack screenOptions={{ headerShown: false }} />
}
