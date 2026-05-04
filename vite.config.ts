import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.match(/\/react\//)) {
              return 'react-vendor';
            }
            if (id.includes('refractor') || id.includes('prismjs') || id.includes('prism')) {
              return 'prism';
            }
            if (id.includes('@uiw/react-md-editor') || id.includes('@uiw/react-markdown-preview')) {
              return 'md-editor';
            }
            if (id.includes('rehype') || id.includes('remark') || id.includes('unified') || id.includes('unist')) {
              return 'markdown-processor';
            }
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
