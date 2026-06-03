import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      recharts: path.resolve(__dirname, "./node_modules/recharts/es6/index.js"),
      "es-toolkit/compat/get": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/get.ts"
      ),
      "es-toolkit/compat/isPlainObject": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/isPlainObject.ts"
      ),
      "es-toolkit/compat/last": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/last.ts"
      ),
      "es-toolkit/compat/maxBy": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/maxBy.ts"
      ),
      "es-toolkit/compat/minBy": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/minBy.ts"
      ),
      "es-toolkit/compat/omit": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/omit.ts"
      ),
      "es-toolkit/compat/range": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/range.ts"
      ),
      "es-toolkit/compat/sortBy": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/sortBy.ts"
      ),
      "es-toolkit/compat/sumBy": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/sumBy.ts"
      ),
      "es-toolkit/compat/throttle": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/throttle.ts"
      ),
      "es-toolkit/compat/uniqBy": path.resolve(
        __dirname,
        "./src/lib/es-toolkit-compat/uniqBy.ts"
      ),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "./node_modules/react/jsx-runtime.js"
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "./node_modules/react/jsx-dev-runtime.js"
      ),
    },
  },
})
