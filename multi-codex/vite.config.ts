import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import Pages from 'vite-plugin-pages';
import devtools from 'solid-devtools/vite';

export default defineConfig({
  plugins: [
    devtools(),
    Pages({
      dirs: ['src/pages'],
    }),
    solidPlugin(),
  ],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
    // Capacitor serves from file:// so all asset paths must be relative
    assetsDir: 'assets',
  },
  // Ensure built assets use relative paths for the Android WebView
  base: '',
});
