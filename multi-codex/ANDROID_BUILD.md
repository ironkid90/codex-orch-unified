# Android APK Build Guide

This guide explains how to build the **Codex Game** as an Android APK using
[Capacitor](https://capacitorjs.com/).

## Prerequisites

| Tool              | Version  | Notes                                         |
|-------------------|----------|-----------------------------------------------|
| Node.js           | ≥ 20     | Required for Vite + Capacitor CLI             |
| npm               | ≥ 10     | Comes with Node.js                            |
| Android Studio    | Latest   | Provides SDK, emulator, and Gradle            |
| Java JDK          | 17+      | Required by Gradle / Android Gradle Plugin    |

After installing Android Studio, open **SDK Manager** and install:

- Android SDK Platform 36 (or the latest available)
- Android Build-Tools
- Android SDK Command-line Tools

Set the `ANDROID_HOME` environment variable:

```bash
# macOS / Linux (add to ~/.bashrc or ~/.zshrc)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

# Windows (System Properties → Environment Variables)
# ANDROID_HOME = C:\Users\<user>\AppData\Local\Android\Sdk
```

## Project Structure

```
multi-codex/
├── capacitor.config.ts     # Capacitor configuration
├── android/                # Native Android project (auto-generated)
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   ├── java/com/codexorch/game/MainActivity.java
│   │   │   └── assets/public/   # Web build copied here on sync
│   │   └── build.gradle
│   ├── build.gradle
│   └── variables.gradle
├── src/                    # Solid.js web source
├── dist/                   # Vite build output (web assets)
└── package.json
```

## Quick Start

```bash
# 1. Install dependencies
cd multi-codex
npm install

# 2. Build web assets and sync to Android
npm run android:build

# 3. Open in Android Studio to build APK
npm run cap:open
```

## Build Commands

| Script              | Description                                             |
|---------------------|---------------------------------------------------------|
| `npm run build`     | Build the web app (output to `dist/`)                   |
| `npm run cap:sync`  | Copy `dist/` into the Android project and update plugins|
| `npm run cap:open`  | Open the Android project in Android Studio              |
| `npm run android:build` | Build web + sync Android in one step                |
| `npm run android:run`   | Build, sync, and run on connected device/emulator   |

## Building the APK

### Option A — Android Studio (Recommended)

1. Run `npm run android:build` to compile and sync.
2. Run `npm run cap:open` to open the project in Android Studio.
3. In Android Studio select **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. The APK is generated at  
   `android/app/build/outputs/apk/debug/app-debug.apk`.

### Option B — Command Line (Gradle)

```bash
# After running npm run android:build
cd android
./gradlew assembleDebug
```

The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

### Release APK

For a signed release build:

```bash
cd android
./gradlew assembleRelease
```

> You must configure signing in `android/app/build.gradle` before building a
> release APK. See the
> [Android signing docs](https://developer.android.com/studio/publish/app-signing).

## Testing on a Device

### Physical Device

1. Enable **Developer Options** and **USB Debugging** on your phone.
2. Connect via USB.
3. Run `npm run android:run` or use Android Studio's **Run** button.

### Emulator

1. Open Android Studio → **Device Manager** → create a device.
2. Start the emulator.
3. Run `npm run android:run`.

## Live Reload During Development

For faster iteration, start the Vite dev server and point Capacitor at it:

```bash
# Terminal 1: start Vite dev server
npm run dev

# Terminal 2: run on device with live reload
npx cap run android --livereload --external
```

## Capacitor Plugins Included

| Plugin                    | Purpose                                     |
|---------------------------|---------------------------------------------|
| `@capacitor/app`          | Android back-button handling, app lifecycle  |
| `@capacitor/status-bar`   | Status bar color and style                   |
| `@capacitor/splash-screen`| Launch splash screen configuration           |
| `@capacitor/keyboard`     | Soft keyboard resize behavior                |

## Troubleshooting

- **White screen on device:** Make sure `base: ''` is set in `vite.config.ts`
  so asset paths are relative.
- **Plugins not found:** Run `npx cap sync android` after installing new
  Capacitor plugins.
- **Gradle errors:** Ensure `ANDROID_HOME` is set and you have SDK Platform 36
  installed.
- **Back button closes app immediately:** The `@capacitor/app` listener in
  `src/app.tsx` handles history navigation; verify it is not removed.
