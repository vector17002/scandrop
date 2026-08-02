import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://scandrop-alb-1254203703.ap-south-1.elb.amazonaws.com',
        // target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
})
