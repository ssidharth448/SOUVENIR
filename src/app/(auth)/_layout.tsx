import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@clerk/expo'

export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return null
  if (isSignedIn) return <Redirect href="/(app)" />
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
}
