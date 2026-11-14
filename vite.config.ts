import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isGitHubActions = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.GITHUB_ACTIONS,
);

export default defineConfig({
  // GitHub project Pages live under /watermark/; local builds stay at root.
  base: isGitHubActions ? '/watermark/' : '/',
  plugins: [react()],
  server: {
    port: 42069,
    strictPort: false
  },
  optimizeDeps: {
    include: ['wink-nlp', 'wink-eng-lite-web-model']
  }
});
