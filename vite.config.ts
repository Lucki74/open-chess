import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import { buildCsp } from './electron/csp'

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  worker: { format: 'es' },
  plugins: [
    {
      // Injects the CSP meta tag (covers file:// loads). Dev adds ws:// for HMR.
      name: 'chess-csp-meta',
      transformIndexHtml: {
        order: 'pre',
        handler: (html, ctx) =>
          html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${buildCsp(!!ctx.server)}" />`),
      },
    },
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        vite: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } } } },
      },
    }),
  ],
})
