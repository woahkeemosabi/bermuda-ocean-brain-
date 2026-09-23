import { defineConfig } from 'vite';
import { createBrowserViteConfig } from 'gods-eye-view/build/vite';

const googleApiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || '';
const cesiumToken = process.env.VITE_CESIUM_ION_TOKEN || '';
const upstream = createBrowserViteConfig({ googleApiKey, cesiumToken });

export default defineConfig({
  ...upstream,
  base: '/',
  build: {
    ...upstream.build,
    outDir: 'dist',
    sourcemap: false,
  },
});
