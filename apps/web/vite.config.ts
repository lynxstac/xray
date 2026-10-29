import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev rejimida API so'rovlari lokal X-Ray serveriga yo'naltiriladi (XRAY_API=http://127.0.0.1:PORT).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': process.env.XRAY_API ?? 'http://127.0.0.1:8787' } },
});
