import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
<<<<<<< HEAD
=======
  server: {
    port: 5173,
    strictPort: true
  },
>>>>>>> 51dbaa4 (Initial commit)
  build: {
    outDir: '../deploy_v5/public'
  }
})
