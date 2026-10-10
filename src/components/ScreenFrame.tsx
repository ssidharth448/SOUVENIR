import { Image, StyleSheet, View } from 'react-native'
import { colors } from '@/constants/theme'

// The light-blue border + white page + wavy stamp footer shared by every screen.
export function ScreenFrame({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.outer}>
      <View style={styles.inner}>
        {children}
        <Image
          source={require('../../assets/images/waves.png')}
          style={styles.footer}
          resizeMode="cover"
          pointerEvents="none"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.frame, padding: 7 },
  inner: { flex: 1, backgroundColor: colors.white, overflow: 'hidden' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height: 105 },
})
