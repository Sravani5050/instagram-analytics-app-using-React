import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxies /api/* to the backend during development, so the frontend
// code can just call fetch("/api/posts") etc. without worrying about
// CORS or hardcoding a backend URL. In production, either serve both
// from behind the same reverse proxy, or set VITE_API_BASE_URL (see
// src/api.js) to point at wherever the backend is deployed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
