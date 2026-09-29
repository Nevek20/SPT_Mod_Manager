import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// Aplica o tema ANTES do primeiro desenho. Esperar o useEffect do App fazia quem
// usa Windows no claro ver um piscar do tema escuro a cada abertura.
try {
  const salvo = localStorage.getItem("spt-mod-manager.theme");
  const escolhido = salvo === "dark" || salvo === "light" ? salvo : "system";
  document.documentElement.dataset.theme =
    escolhido === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : escolhido;
} catch {
  // Sem armazenamento: o App aplica o tema do sistema logo em seguida.
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);