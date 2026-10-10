import 'react-native-url-polyfill/auto'
import { useMemo } from 'react'
import { useSession } from '@clerk/expo'
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// Supabase reads the Clerk session token, so RLS sees the Clerk user id
// via auth.jwt()->>'sub'. A fresh token is fetched on every request.
export function useSupabase() {
  const { session } = useSession()

  return useMemo(
    () =>
      createClient(url, anonKey, {
        accessToken: async () => (await session?.getToken()) ?? null,
      }),
    [session]
  )
}
