import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    // A CSP do app (default-src 'self') não permite data: URIs. Sem isso, o
    // Vite embute arquivos pequenos (tipo os subconjuntos de fonte menos
    // usados) como base64 direto no CSS, e o navegador bloqueia esse
    // carregamento. Desligando o limite, todo arquivo vira um asset físico
    // de verdade, servido de 'self' — sem conflito com a CSP.
    assetsInlineLimit: 0
  }
});