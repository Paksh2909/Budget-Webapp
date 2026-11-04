import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (mode === 'production' && !/^https:\/\//.test(env.VITE_API_URL ?? '')) {
    throw new Error('VITE_API_URL must be set to your Worker URL (https://...) for production builds.');
  }
  return {
    // GitHub Pages serves project sites from /<repo>/; the deploy workflow sets BASE_PATH.
    base: env.BASE_PATH || '/',
    plugins: [react()],
    // Dev server stays on localhost (Vite default); no --host.
    server: { port: 5173, strictPort: true },
  };
});
