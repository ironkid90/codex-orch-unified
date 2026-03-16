import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

/**
 * Initialize Capacitor plugins when running as a native Android app.
 * On web this is a no-op so the same build works in a browser too.
 */
export function initCapacitor(): void {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  // Configure the status bar for immersive game UI
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {});

  // Hide the splash screen once the app is ready
  SplashScreen.hide().catch(() => {});
}
