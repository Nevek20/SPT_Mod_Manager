import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ehTema, temaEfetivo, hexValido, coresDeDestaque } from "./theme";
import "./App.css";

// Aplica o tema ANTES do primeiro desenho. Esperar o useEffect do App fazia quem
// usa Windows no claro ver um piscar do tema escuro a cada abertura. Lê os
// mesmos temas do theme.ts: a lista fixa daqui ficou pra trás na 0.8.0, e quem
// usava Preto, Oliva ou Alto contraste via um piscar do tema do sistema.
try {
  const raiz = document.documentElement;
  const salvo = localStorage.getItem("spt-mod-manager.theme");
  const efetivo = temaEfetivo(ehTema(salvo) ? salvo : "system", window.matchMedia("(prefers-color-scheme: dark)").matches);
  raiz.dataset.theme = efetivo;
  if (localStorage.getItem("spt-mod-manager.colorblind") === "on") raiz.dataset.cvd = "on";
  const destaque = hexValido(localStorage.getItem("spt-mod-manager.accent"));
  if (destaque) {
    const cores = coresDeDestaque(destaque, efetivo);
    raiz.dataset.accent = "custom";
    raiz.style.setProperty("--accent", cores.accent);
    raiz.style.setProperty("--accent-strong", cores.accentStrong);
    raiz.style.setProperty("--on-accent", cores.onAccent);
  }
  const movimento = localStorage.getItem("spt-mod-manager.motion");
  if (movimento === "on" || movimento === "off") raiz.dataset.motion = movimento;
} catch {
  // Sem armazenamento: o App aplica o tema do sistema logo em seguida.
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Erro ao desenhar vira uma tela com o erro e saídas, não janela vazia. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
