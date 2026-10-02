/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/seating-lab',
  server:{
    port: 4200,
    host: 'localhost',
  },
  preview:{
    port: 4200,
    host: 'localhost',
  },
  plugins: [react()],
  resolve: {
    alias: [{ find: /^fs$/, replacement: fileURLToPath(new URL('./src/empty-node-fs.ts', import.meta.url)) }],
  },
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Виджет и WebView-хост собираются отдельными страницами: встраиваемая часть
      // не тянет интерфейс стенда, а мобильный хост не тянет интерфейс виджета.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        widget: fileURLToPath(new URL('./widget.html', import.meta.url)),
        webviewHost: fileURLToPath(new URL('./webview-host.html', import.meta.url)),
        mockPayment: fileURLToPath(new URL('./mock-payment.html', import.meta.url)),
        siteHost: fileURLToPath(new URL('./site-host.html', import.meta.url)),
      },
    },
  },
  test: {
    name: 'seating-lab',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    }
  },
}));
