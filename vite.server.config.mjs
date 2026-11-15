import {defineConfig} from 'vite';

export default defineConfig({
  build: {ssr: 'server/production-entry.mjs', outDir: 'dist-server', target: 'node24',
    rollupOptions: {output: {entryFileNames: 'server.mjs'}}},
});
