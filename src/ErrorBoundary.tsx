/**
 * Rede de segurança da interface.
 *
 * Sem isto, qualquer erro ao desenhar a tela desmontava o React inteiro e
 * sobrava a janela vazia (branca, ou com a cor de fundo do tema). E como a
 * causa costuma estar em algo SALVO (lista de mods, preferências da
 * interface), reinstalar o app não resolvia: foi o relato do ronpo, "tela
 * preta/branca há dias, mesmo reinstalando".
 *
 * Agora o erro aparece, dá pra copiar o relato ou abrir uma issue, e dá pra
 * limpar as preferências da interface, que é a saída quando a causa está nelas.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate, detectSystemLang, SUPPORTED_LANGS, type Lang } from "./i18n";
import { montaRelato, urlIssueGithub } from "./reportError";

const PREFIXO = "spt-mod-manager.";
// Idioma e boas-vindas não são a causa de nada e perder isso irrita.
const PRESERVAR = new Set([`${PREFIXO}lang`, `${PREFIXO}welcomed`]);

function idioma(): Lang {
  try {
    const salvo = localStorage.getItem(`${PREFIXO}lang`);
    if (salvo && (SUPPORTED_LANGS as string[]).includes(salvo)) return salvo as Lang;
  } catch {
    // sem armazenamento
  }
  return detectSystemLang();
}

/** Apaga as preferências da interface (filtros, grupos abertos, tema...). */
export function limparPreferenciasDaInterface(): number {
  let apagadas = 0;
  try {
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith(PREFIXO) && !PRESERVAR.has(chave)) {
        localStorage.removeItem(chave);
        apagadas++;
      }
    }
  } catch {
    // sem armazenamento: nada a limpar
  }
  return apagadas;
}

interface Estado {
  erro: Error | null;
  pilha: string;
  copiado: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { erro: null, pilha: "", copiado: false };

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    this.setState({ pilha: `${erro?.stack ?? erro}\n${info.componentStack ?? ""}`.trim() });
  }

  private texto(): string {
    const e = this.state.erro;
    return `Interface error: ${e?.message ?? String(e)}\n\n${this.state.pilha}`.slice(0, 6000);
  }

  private async relato(): Promise<string> {
    try {
      const diag = await window.modManagerAPI.getDiagnostics();
      const spt = await window.modManagerAPI.getSptSemver().catch(() => undefined);
      return montaRelato(this.texto(), diag, spt);
    } catch {
      return this.texto();
    }
  }

  private copiar = async () => {
    const r = await this.relato();
    await window.modManagerAPI.copyText(r).catch(() => undefined);
    this.setState({ copiado: true });
  };

  private abrirIssue = async () => {
    const r = await this.relato();
    await window.modManagerAPI.openReleasePage(urlIssueGithub(this.texto(), r)).catch(() => undefined);
  };

  private limparERecarregar = () => {
    limparPreferenciasDaInterface();
    window.location.reload();
  };

  render() {
    if (!this.state.erro) return this.props.children;
    const lang = idioma();
    const t = (k: string) => translate(lang, k);
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-box">
          <h1>{t("crash.title")}</h1>
          <p>{t("crash.intro")}</p>
          <pre className="crash-message">{this.state.erro?.message ?? String(this.state.erro)}</pre>
          <div className="crash-actions">
            <button className="primary" onClick={() => window.location.reload()}>
              {t("crash.reload")}
            </button>
            <button onClick={this.limparERecarregar} title={t("crash.resetUiTitle")}>
              {t("crash.resetUi")}
            </button>
            <button onClick={() => void this.copiar()}>{this.state.copiado ? t("crash.copied") : t("crash.copy")}</button>
            <button onClick={() => void this.abrirIssue()}>{t("crash.report")}</button>
          </div>
          <p className="crash-note">{t("crash.note")}</p>
          <details>
            <summary>{t("crash.details")}</summary>
            <pre className="crash-stack">{this.state.pilha}</pre>
          </details>
        </div>
      </div>
    );
  }
}
