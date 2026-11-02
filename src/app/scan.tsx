import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QrScanner } from '@/components/qr-scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import {
  formatHandledQr,
  handleScannedQr,
  type ScannedQr,
} from '@/lib/handle-scanned-qr';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState(true);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const onScanned = useCallback(async (scanned: ScannedQr) => {
    setScanning(false);

    const handled = handleScannedQr(scanned);
    setLastResult(formatHandledQr(handled));

    if (handled.kind === 'url') {
      await openBrowserAsync(handled.url, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    }
  }, []);

  return (
    <ThemedView style={styles.container}>
      <QrScanner onScanned={onScanned} enabled={scanning} />

      <View
        style={[
          styles.resultBar,
          { paddingBottom: insets.bottom + BottomTabInset + Spacing.two },
        ]}>
        {lastResult ? (
          <>
            <ThemedText type="smallBold">Прочитано:</ThemedText>
            <ThemedText type="code" themeColor="textSecondary" selectable>
              {lastResult}
            </ThemedText>
            <Pressable
              onPress={() => {
                setLastResult(null);
                setScanning(true);
              }}
              style={styles.scanAgain}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                Скенирај повторно
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Резултатот ќе се појави овде откако ќе се прочита QR кодот.
          </ThemedText>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  resultBar: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  scanAgain: {
    alignSelf: 'flex-start',
    backgroundColor: '#208AEF',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  buttonLabel: {
    color: '#ffffff',
  },
});
