import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsChecker from 'vite-plugin-checker'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

const PORT = 4310

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const outDir = env.VITE_OUTPUT_PATH || 'dist'

  return {
    base: env.VITE_BASE_URL || '/',
    logLevel: 'info',
    plugins: [
      react(),
      tailwindcss(),
      // Not under vitest. The checker runs in WATCH mode, so it keeps handles open past the end
      // of a one-shot `vitest run` and leaves pool workers behind when a run's parent exits
      // abruptly - orphaned `node (vitest N)` processes that spin at ~25 % CPU each. Nothing is
      // lost by skipping it here: `npm run type-check` runs tsc against this same tsconfig.
      ...(process.env.VITEST
        ? []
        : [tsChecker({ typescript: { tsconfigPath: './tsconfig.app.json' } })]),
      visualizer({
        filename: `${outDir}/stats-treemap.html`,
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
      }),
    ],
    build: {
      outDir,
      assetsDir: 'assets',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('@mantine')) return 'mantine'
            if (id.includes('framer-motion')) return 'framer-motion'
            if (id.includes('@reduxjs') || id.includes('react-redux')) return 'redux'
            if (id.includes('react-router')) return 'react-router'
            if (id.includes('react-icons')) return 'react-icons'
          },
          assetFileNames: assetInfo => {
            let extType = assetInfo.name?.split('.').at(1)
            if (extType && /png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType)) {
              extType = 'img'
            }
            return `assets/${extType}/[name]-[hash][extname]`
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@tests': path.resolve(__dirname, './tests'),
      },
    },
    server: { port: PORT, open: true },
    preview: { port: PORT },
    test: {
      // `docs/build_state.json` is LIVE production data: it is regenerated every build,
      // committed, and compiled into the shipped bundle. Tests pin numbers computed by hand
      // from one specific report, so under Vitest every import of it resolves to the frozen
      // oracle instead. That is what lets the live file change without touching a test.
      //
      // To assert against the LIVE file - `tests/features/build/model/liveReport.contract.test.ts`
      // - read it with `fs`. This alias rewrites import specifiers and will not catch an fs read.
      //
      // The pattern MUST be anchored with `^.*`. Vite replaces only the matched portion of the
      // specifier, so an unanchored /docs\/build_state\.json$/ leaves the importer's `../../../../`
      // in front of an absolute path and the import fails to resolve.
      alias: [
        {
          find: /^.*docs\/build_state\.json$/,
          replacement: path.resolve(__dirname, './tests/fixtures/build_state.reference.json'),
        },
      ],
      globals: true,
      environment: 'jsdom',
      setupFiles: 'tests/setup.ts',
      include: ['tests/**/*.test.{ts,tsx}'],
      mockReset: true,
      // Mounting the build record renders 14 phases plus five lazily loaded reports, which takes
      // several seconds in jsdom and longer while the whole suite runs in parallel. At the 5s
      // default those tests failed as "unable to find element" - a timing problem wearing the
      // costume of a missing one. Raised globally rather than per-describe so a new shell test
      // does not have to rediscover this.
      testTimeout: 30_000,
    },
    define: {
      __APP_ENV__: JSON.stringify(env.VITE_APP_ENV),
    },
  }
})
