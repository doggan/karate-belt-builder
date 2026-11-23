import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths, so the build works wherever it is hosted: at a domain's root or
  // under a sub-path like GitHub Pages' https://<user>.github.io/<repo>/.
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
