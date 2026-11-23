import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// viteSingleFile inlines all JS/CSS so `npm run build` produces ONE
// dist/index.html — a drop-in replacement for the original standalone file.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
});
