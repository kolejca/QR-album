import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { ScannedQr } from '@/lib/handle-scanned-qr';

type QrScannerProps = {
  onScanned: (scanned: ScannedQr) => void;
  /** Set to false after a successful scan to stop duplicate reads. */
  enabled?: boolean;
};

export function QrScanner({ onScanned, enabled = true }: QrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isFocused, setIsFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (!enabled) {
        return;
      }

      onScanned({
        data: result.data,
        type: result.type,
      });
    },
    [enabled, onScanned],
  );

  if (!permission) {
    return <ThemedView style={styles.centered} />;
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.message}>
          Потребна е дозвола за камера за да се скенира QR код.
        </ThemedText>
        <Pressable onPress={requestPermission} style={styles.permissionButton}>
          <ThemedText type="smallBold" style={styles.buttonLabel}>
            Дозволи камера
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (!isFocused) {
    return <ThemedView style={styles.flex} />;
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={enabled ? handleBarcodeScanned : undefined}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <ThemedText type="small" style={styles.hint}>
          Насочи ја камерата кон QR кодот
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  message: {
    textAlign: 'center',
  },
  permissionButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    backgroundColor: '#208AEF',
  },
  buttonLabel: {
    color: '#ffffff',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  hint: {
    color: '#ffffff',
    textAlign: 'center',
  },
});
