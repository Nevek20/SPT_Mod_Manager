import { useEffect, useState, useCallback, useMemo, useRef, Fragment, createContext, useContext, type DragEvent, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { buildModTree, type ModTreeNode } from "./modTree";
import type { ModSourceInfo } from "./types";
import {
  ModInfo,
  ModType,
  ConflictReport,
  ForgeUpdateCheckResult,
  ForgeSptVersion,
  ForgeStatusCacheEntry,
  ForgeCatalogMod,
  ForgeCategory,
  InstallResult,
  AppUpdateInfo, ModDependencyInfo, ForgeUpdateItem } from "./types";
import { Lang, translate, translateBackendMessage, LANG_LABELS, SUPPORTED_LANGS, detectSystemLang } from "./i18n";
import { Diagnostico, montaRelato, urlIssueGithub } from "./reportError";
import {
  GroupMode,
  UNCATEGORIZED,
  groupNodes,
  assignNodes,
  categoryOf,
  withAliases,
  removeCategory,
  renameCategory,
  moveCategory,
  newCategoryId,
  forgeIdOf
} from "./modCategories";
import type { CustomCategories, ModProfileSummary, ProfileSwitchResult } from "./types";
import { CompatFilter, sptConstraintFor, minorLabel } from "./browseFilters";
import {
  TEMAS,
  AMOSTRAS,
  ACCENT_PRESETS,
  ehTema,
  hexValido,
  temaEfetivo,
  coresDeDestaque,
  type TemaEscolhido
} from "./theme";
import { parseChangelogHtml, changelogHasText, type ChangelogNode } from "./changelog";
import type { ModChangelog, DownloadCacheInfo, DownloadQueueJob } from "./types";
import { DOWNLOAD_CACHE_OPTIONS_GB, MAX_DOWNLOADS_OPTIONS } from "./types";

const LANG_STORAGE_KEY = "spt-mod-manager.lang";
const THEME_STORAGE_KEY = "spt-mod-manager.theme";
const ACCENT_STORAGE_KEY = "spt-mod-manager.accent";
const CVD_STORAGE_KEY = "spt-mod-manager.colorblind";
const MOTION_STORAGE_KEY = "spt-mod-manager.motion";
const WELCOMED_STORAGE_KEY = "spt-mod-manager.welcomed";
const GROUP_STORAGE_KEY = "spt-mod-manager.groupBy";
const COLLAPSED_STORAGE_KEY = "spt-mod-manager.collapsedCategories";
const EXPANDED_STORAGE_KEY = "spt-mod-manager.expandedPackages";

function lerLocal<T>(chave: string, padrao: T, valida: (v: unknown) => v is T): T {
  try {
    const bruto = localStorage.getItem(chave);
    if (bruto === null) return padrao;
    const v = JSON.parse(bruto);
    return valida(v) ? v : padrao;
  } catch {
    return padrao;
  }
}
function gravarLocal(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // preferência de exibição: sem armazenamento, vale só nesta sessão
  }
}
const KOFI_URL = "https://ko-fi.com/tioemir";

/** Tipo de dado do arrasto interno de mod entre categorias. */
const ARRASTO_MOD = "application/x-spt-mod-node";
/** Altura, a partir de cada borda, onde segurar o mod faz a lista rolar sozinha. */
const ZONA_ROLAGEM_PX = 150;
const ehModoGrupo = (v: unknown): v is GroupMode => v === "none" || v === "source" || v === "custom";
const ehMapaDeBooleanos = (v: unknown): v is Record<string, boolean> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "boolean");
const ehListaDeTexto = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Lê a escolha salva; qualquer coisa estranha vira "system", o padrão. */
function lerTemaSalvo(): TemaEscolhido {
  try {
    const salvo = localStorage.getItem(THEME_STORAGE_KEY);
    if (ehTema(salvo)) return salvo;
  } catch {
    // Sem acesso ao armazenamento: segue o sistema.
  }
  return "system";
}

/** Cor de destaque escolhida (#rrggbb) ou null = a do tema. */
function lerDestaqueSalvo(): string | null {
  try {
    return hexValido(localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function lerDaltonicoSalvo(): boolean {
  try {
    return localStorage.getItem(CVD_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function gravarPreferencia(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    // Sem armazenamento: vale só pra esta sessão.
  }
}

const NOMES_TEMA: Record<TemaEscolhido, string> = {
  system: "settings.themeSystem",
  dark: "settings.themeDark",
  light: "settings.themeLight",
  sand: "settings.themeSand",
  black: "settings.themeBlack",
  olive: "settings.themeOlive",
  contrast: "settings.themeContrast"
};

interface Toast {
  id: number;
  text: string;
  ok: boolean;
  /** Mensagem original do backend (em inglês). Só existe em erro que dá pra relatar. */
  raw?: string;
}

/** Mensagens que vêm como falha mas são escolha do usuário, não defeito: sem "Detalhes". */
const NAO_RELATAVEL = new Set(["Cancelled.", "Installation cancelled."]);

function relatavel(raw?: string): raw is string {
  return Boolean(raw) && !NAO_RELATAVEL.has(raw!.trim());
}

type TypeFilter = "all" | ModType;
type StatusFilter = "all" | "enabled" | "disabled";
type OriginFilter = "all" | "manual" | "manager";
type FikaFilter = "all" | "compatible" | "incompatible";
type ForgeStatusInfo = Omit<ForgeStatusCacheEntry, "name">;
type SortField = "name" | "status" | "origin" | "installedAt" | "forge";
type SortDirection = "asc" | "desc";

/**
 * Miniatura de um mod no catálogo, com nova tentativa em caso de falha.
 *
 * Uma página abre 24 requisições de imagem de uma vez pro mesmo servidor, e
 * parte delas volta com erro por limite de taxa. Antes o app desistia na
 * primeira falha e mostrava o quadrado cinza, que é exatamente o mesmo
 * desenho de um mod SEM miniatura — então o usuário não tinha como saber que
 * a imagem existia e não carregou.
 *
 * A espera dobra a cada tentativa e leva um sorteio junto: sem ele, as imagens
 * que falharam juntas tentariam de novo todas no mesmo instante, reproduzindo
 * a rajada que causou o problema.
 */
function ForgeThumb({ src }: { src?: string }) {
  const [tentativa, setTentativa] = useState(0);
  const [desistiu, setDesistiu] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const MAX_TENTATIVAS = 3;

  useEffect(() => {
    setTentativa(0);
    setDesistiu(false);
    setCarregou(false);
  }, [src]);

  if (!src || desistiu) return <div className="forge-mod-thumb forge-mod-thumb-placeholder" />;

  return (
    <>
      {/* O placeholder fica por baixo até a imagem carregar. Sem isso, o
          <img> em falha desenha o ícone de papel rasgado do navegador, que é
          mais feio que o quadrado cinza e ainda por cima aparece durante as
          tentativas, quando ainda pode dar certo. */}
      {!carregou && <div className="forge-mod-thumb forge-mod-thumb-placeholder" />}
      <img
        // A chave inclui a tentativa pra forçar o React a recriar o elemento:
        // reatribuir o mesmo src num <img> que já falhou não dispara pedido novo.
        key={tentativa}
        src={src}
        alt=""
        className={`forge-mod-thumb${carregou ? "" : " forge-mod-thumb-carregando"}`}
        // Sem carregamento preguiçoso de propósito: a lista tem rolagem
        // própria, e o navegador mede a visibilidade em relação à JANELA. Os
        // últimos itens ficavam abaixo do fim do contêiner e nunca eram
        // pedidos, nem depois de rolar até eles. Uma página tem no máximo 24
        // miniaturas de alguns KB, então buscar todas é barato.
        decoding="async"
        onLoad={() => setCarregou(true)}
        onError={() => {
          if (tentativa + 1 >= MAX_TENTATIVAS) {
            setDesistiu(true);
            return;
          }
          const espera = 400 * 2 ** tentativa + Math.random() * 300;
          window.setTimeout(() => setTentativa((n) => n + 1), espera);
        }}
      />
    </>
  );
}

/**
 * Nome de mod na lista da checagem de atualização. Com o id da fonte, vira link
 * pra aba de versões da página do mod (pedido do inganshin): é ali que o autor
 * avisa quando a versão nova pede instalação limpa.
 */
function NomeComPagina({ nome, modId, titulo }: { nome: string; modId?: number; titulo: string }) {
  if (modId === undefined) return <>{nome}</>;
  return (
    <button
      className="link-button mod-page-link"
      title={titulo}
      onClick={() => void window.modManagerAPI.openForgeModPage(modId, "versions")}
    >
      {nome}
    </button>
  );
}

/** Desenha a árvore do changelog. Só tags da lista fechada, texto escapado pelo React. */
function renderChangelog(nodes: ChangelogNode[], prefixo = "c"): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${prefixo}-${i}`;
    if (typeof n === "string") return <Fragment key={key}>{n}</Fragment>;
    const filhos = renderChangelog(n.children, key);
    switch (n.tag) {
      case "h":
        return <h5 key={key}>{filhos}</h5>;
      case "br":
        return <br key={key} />;
      case "hr":
        return <hr key={key} />;
      case "a":
        // Não é clicável: abrir endereço de fora passaria por cima da allowlist
        // de links do app. O endereço fica no title pra quem quiser copiar.
        return (
          <span key={key} className="changelog-link" title={n.href}>
            {filhos}
          </span>
        );
      default: {
        const Tag = n.tag;
        return <Tag key={key}>{filhos}</Tag>;
      }
    }
  });
}

type EstadoChangelog =
  | { status: "loading" }
  | { status: "ok"; data: ModChangelog }
  | { status: "error"; message: string };

/**
 * Idioma e tradução pro balão do changelog, que aparece tanto no painel de
 * atualizações quanto na lista de mods: sem isso, cada nível da lista teria que
 * repassar lang/t/tMsg por props.
 */
const ChangelogI18n = createContext<{
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tMsg: (msg: string | undefined | null) => string;
}>({ lang: "en", t: (k) => k, tMsg: (m) => m ?? "" });

/**
 * Changelog já carregado, por mod e intervalo. Abrir pelo chip da lista e depois
 * pelo painel não pede de novo. Erro não fica guardado: tentar de novo é o
 * jeito de a pessoa sair dele.
 */
const cacheChangelog = new Map<string, ModChangelog>();
/** Só um balão aberto por vez: abrir outro fecha o anterior. */
let fechaBalaoAberto: (() => void) | null = null;

const BALAO_LARGURA = 440;
const BALAO_ALTURA = 380;

function IconeNota() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M5.5 7.5h5 M5.5 10h5 M5.5 12.5h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Ícone de changelog com balão (pedido do trex0113, no estilo do Vortex).
 * Abre no clique, não no hover: passar o mouse pela lista não pode ficar
 * abrindo balão. Carrega só quando abre, uma vez: checar atualização de 80 mods
 * não vira 80 pedidos de changelog que ninguém pediu.
 */
function ChangelogButton({ modId, nome, de, para }: { modId: number; nome: string; de?: string; para?: string }) {
  const { lang, t, tMsg } = useContext(ChangelogI18n);
  const chave = `${modId}|${de ?? ""}|${para ?? ""}`;
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<EstadoChangelog | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLDivElement>(null);

  const fechar = useCallback(() => setAberto(false), []);

  function posicionar() {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    const margem = 8;
    const abaixo = window.innerHeight - r.bottom - margem;
    const acima = r.top - margem;
    // Embaixo por padrão; em cima só quando não cabe e em cima tem mais espaço
    // (último mod da lista, por exemplo).
    const vaiAcima = abaixo < Math.min(BALAO_ALTURA, 240) && acima > abaixo;
    const maxHeight = Math.max(160, Math.min(BALAO_ALTURA, vaiAcima ? acima : abaixo));
    const left = Math.max(margem, Math.min(r.left, window.innerWidth - BALAO_LARGURA - margem));
    const top = vaiAcima ? r.top - 6 - maxHeight : r.bottom + 6;
    setPos({ top, left, maxHeight });
  }

  function alternar() {
    if (aberto) {
      setAberto(false);
      return;
    }
    fechaBalaoAberto?.();
    fechaBalaoAberto = fechar;
    posicionar();
    setAberto(true);
    const guardado = cacheChangelog.get(chave);
    if (guardado) {
      setEstado({ status: "ok", data: guardado });
      return;
    }
    if (estado?.status === "loading") return;
    setEstado({ status: "loading" });
    window.modManagerAPI
      .fetchModChangelog(modId, de, para)
      .then((r) => {
        if (r.success && r.result) {
          cacheChangelog.set(chave, r.result);
          setEstado({ status: "ok", data: r.result });
        } else {
          setEstado({ status: "error", message: r.message ?? "" });
        }
      })
      .catch((err) => setEstado({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  }

  useEffect(() => {
    if (!aberto) {
      if (fechaBalaoAberto === fechar) fechaBalaoAberto = null;
      return;
    }
    const foraDoBalao = (alvo: EventTarget | null) =>
      !(alvo instanceof Node && (balao.current?.contains(alvo) || botao.current?.contains(alvo)));
    const onMouseDown = (e: MouseEvent) => {
      if (foraDoBalao(e.target)) setAberto(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
    };
    // O balão é fixo na tela: se a lista rolar por baixo dele, ele ficaria
    // apontando pro mod errado. Rolar dentro do próprio balão não conta.
    const onScroll = (e: Event) => {
      if (foraDoBalao(e.target)) setAberto(false);
    };
    const onResize = () => setAberto(false);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [aberto, fechar]);

  const data = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <>
      <button
        ref={botao}
        className={`changelog-button${aberto ? " active" : ""}`}
        title={t("changelog.show")}
        aria-label={t("changelog.show")}
        aria-expanded={aberto}
        onClick={alternar}
      >
        <IconeNota />
      </button>
      {aberto &&
        pos &&
        createPortal(
          <div
            ref={balao}
            className="changelog-popover"
            role="dialog"
            aria-label={t("changelog.show")}
            style={{ top: pos.top, left: pos.left, width: BALAO_LARGURA, maxHeight: pos.maxHeight }}
          >
            <div className="changelog-popover-head">
              <strong>{t("changelog.show")}</strong>
              <span className="changelog-popover-mod">
                {nome}
                {de && para ? ` · ${de} → ${para}` : para ? ` · ${para}` : ""}
              </span>
            </div>
            <div className="changelog-popover-body">
              {estado?.status === "loading" && <p className="changelog-muted">{t("changelog.loading")}</p>}
              {estado?.status === "error" && <p className="changelog-error">{tMsg(estado.message)}</p>}
              {estado?.status === "ok" && estado.data.entries.length === 0 && (
                <p className="changelog-muted">{t("changelog.none")}</p>
              )}
              {estado?.status === "ok" &&
                estado.data.entries.map((e) => {
                  const nodes = parseChangelogHtml(e.html);
                  return (
                    <div key={e.version} className="changelog-entry">
                      <div className="changelog-entry-head">
                        <strong>{e.version}</strong>
                        {e.publishedAt && <span className="changelog-date">{data(e.publishedAt)}</span>}
                      </div>
                      {changelogHasText(nodes) ? (
                        <div className="changelog-body">{renderChangelog(nodes)}</div>
                      ) : (
                        <p className="changelog-muted">{t("changelog.noNotes")}</p>
                      )}
                    </div>
                  );
                })}
              {(estado?.status === "error" || (estado?.status === "ok" && estado.data.olderCount > 0)) && (
                <button
                  className="link-button changelog-more"
                  onClick={() => void window.modManagerAPI.openForgeModPage(modId, "versions")}
                >
                  {estado.status === "error" ? t("forge.openVersions") : t("changelog.older")}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function IconeFila({ tipo }: { tipo: "up" | "down" | "pause" | "play" | "x" }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {tipo === "up" && <path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      {tipo === "down" && <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      {tipo === "pause" && (
        <>
          <rect x="2.2" y="1.5" width="2.6" height="9" fill="currentColor" />
          <rect x="7.2" y="1.5" width="2.6" height="9" fill="currentColor" />
        </>
      )}
      {tipo === "play" && <path d="M3 1.5v9l7-4.5z" fill="currentColor" />}
      {tipo === "x" && <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

/** Tempo restante curto: "17s", "3 min", "1 h 5 min". */
function formatEta(segundos: number): string {
  const s = Math.max(1, Math.round(segundos));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

function selectionKey(mod: ModInfo): string {
  return `${mod.type}:${mod.id}`;
}

function ToastStack({
  toasts,
  detalhesLabel,
  onDetalhes
}: {
  toasts: Toast[];
  detalhesLabel: string;
  onDetalhes: (toast: Toast) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.ok ? "toast-ok" : "toast-error"}`}>
          {t.ok ? "✔ " : "❌ "}
          {t.text}
          {!t.ok && relatavel(t.raw) && (
            <button className="toast-details" onClick={() => onDetalhes(t)}>
              {detalhesLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const salvo = localStorage.getItem(LANG_STORAGE_KEY) as Lang | null;
    // Só aceita o que está gravado se ainda for um idioma suportado: uma chave
    // antiga ou editada na mão deixaria a interface sem dicionário.
    if (salvo && SUPPORTED_LANGS.includes(salvo)) return salvo;
    return detectSystemLang();
  });
  function changeLang(next: Lang) {
    setLang(next);
    localStorage.setItem(LANG_STORAGE_KEY, next);
  }
  function t(key: string, vars?: Record<string, string | number>): string {
    return translate(lang, key, vars);
  }
  function tMsg(msg: string | undefined | null): string {
    return translateBackendMessage(msg, lang);
  }

  // Tema: "system" segue o Windows e muda junto se a pessoa trocar o tema do PC
  // com o app aberto. O CSS só troca variáveis pelo atributo data-theme.
  const [tema, setTema] = useState<TemaEscolhido>(lerTemaSalvo);
  // Cor de destaque própria (null = a do tema) e modo daltônico, que vale pra
  // qualquer tema: quem tem daltonismo não precisa abrir mão do tema preferido.
  const [destaque, setDestaque] = useState<string | null>(lerDestaqueSalvo);
  const [daltonico, setDaltonico] = useState<boolean>(lerDaltonicoSalvo);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const raiz = document.documentElement;
    const aplica = () => {
      const efetivo = temaEfetivo(tema, media.matches);
      raiz.dataset.theme = efetivo;
      if (daltonico) raiz.dataset.cvd = "on";
      else delete raiz.dataset.cvd;
      // A cor escolhida é ajustada ao tema (ver coresDeDestaque): o mesmo
      // amarelo fica mais escuro no tema Claro pra continuar legível.
      if (destaque) {
        const cores = coresDeDestaque(destaque, efetivo);
        raiz.dataset.accent = "custom";
        raiz.style.setProperty("--accent", cores.accent);
        raiz.style.setProperty("--accent-strong", cores.accentStrong);
        raiz.style.setProperty("--on-accent", cores.onAccent);
      } else {
        delete raiz.dataset.accent;
        raiz.style.removeProperty("--accent");
        raiz.style.removeProperty("--accent-strong");
        raiz.style.removeProperty("--on-accent");
      }
    };
    aplica();
    if (tema !== "system") return;
    media.addEventListener("change", aplica);
    return () => media.removeEventListener("change", aplica);
  }, [tema, destaque, daltonico]);
  function mudarTema(proximo: TemaEscolhido) {
    setTema(proximo);
    gravarPreferencia(THEME_STORAGE_KEY, proximo);
  }
  function mudarDestaque(cor: string | null) {
    const valida = cor === null ? null : hexValido(cor);
    setDestaque(valida);
    gravarPreferencia(ACCENT_STORAGE_KEY, valida);
  }
  // Aceleração de hardware: desligar resolve janela preta por driver de vídeo.
  // A troca só vale ao reabrir o app; "active" é o que vale agora.
  const [aceleracao, setAceleracao] = useState<{ enabled: boolean; active: boolean } | null>(null);
  useEffect(() => {
    window.modManagerAPI
      .getHardwareAcceleration()
      .then((r) => {
        setAceleracao({ enabled: r.enabled, active: r.active });
        // O app desligou sozinho depois de a placa de vídeo travar: avisa uma vez.
        if (r.autoDisabled) {
          pushToast(t("toast.gpuAutoDisabled"), true);
          void window.modManagerAPI.ackGpuNotice();
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function mudarAceleracao(ligada: boolean) {
    await window.modManagerAPI.setHardwareAcceleration(ligada);
    setAceleracao((a) => (a ? { ...a, enabled: ligada } : a));
  }
  async function reiniciarApp() {
    const r = await window.modManagerAPI.relaunchApp();
    if (!r.success && r.message) pushToast(tMsg(r.message), false, r.message);
  }

  function mudarDaltonico(ligado: boolean) {
    setDaltonico(ligado);
    gravarPreferencia(CVD_STORAGE_KEY, ligado ? "on" : null);
  }

  // Animações: "on"/"off" só quando a pessoa escolheu. Sem escolha, segue o
  // Windows (o CSS lê o prefers-reduced-motion).
  const [animacoes, setAnimacoes] = useState<"on" | "off" | null>(() => {
    try {
      const v = localStorage.getItem(MOTION_STORAGE_KEY);
      return v === "on" || v === "off" ? v : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (animacoes) document.documentElement.dataset.motion = animacoes;
    else delete document.documentElement.dataset.motion;
  }, [animacoes]);
  const animacoesLigadas =
    animacoes === "on" || (animacoes === null && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function mudarAnimacoes(ligadas: boolean) {
    const v = ligadas ? "on" : "off";
    setAnimacoes(v);
    try {
      localStorage.setItem(MOTION_STORAGE_KEY, v);
    } catch {
      // vale só nesta sessão
    }
  }

  const [configAberta, setConfigAberta] = useState(false);

  // Boas-vindas: só na PRIMEIRA abertura de verdade. Quem já usa o app tem uma
  // instância salva e nunca vê isso, nem depois de atualizar pra esta versão.
  const [boasVindas, setBoasVindas] = useState(false);
  function concluirBoasVindas() {
    setBoasVindas(false);
    try {
      localStorage.setItem(WELCOMED_STORAGE_KEY, "1");
    } catch {
      // Sem armazenamento: aparece de novo na próxima abertura, sem prejuízo.
    }
  }
  // Carregados quando a tela de configurações abre: versão do app e do SPT não
  // mudam com o app aberto, mas a instância pode ter sido trocada.
  const [versaoApp, setVersaoApp] = useState<string | null>(null);
  const [sptSemverConfig, setSptSemverConfig] = useState<string | undefined>(undefined);
  const [checagemApp, setChecagemApp] = useState<"idle" | "checking" | "done" | "failed">("idle");

  const [cacheInfo, setCacheInfo] = useState<DownloadCacheInfo | null>(null);
  const [maxDownloadsSel, setMaxDownloadsSel] = useState<number | null>(null);
  const [limpandoCache, setLimpandoCache] = useState(false);

  async function abrirConfig() {
    setConfigAberta(true);
    setChecagemApp("idle");
    const [diag, semver, cache, simultaneos] = await Promise.all([
      window.modManagerAPI.getDiagnostics(),
      window.modManagerAPI.getSptSemver().catch(() => undefined),
      window.modManagerAPI.getDownloadCacheInfo().catch(() => null),
      window.modManagerAPI.getMaxDownloads().catch(() => null)
    ]);
    setVersaoApp(diag.appVersion);
    setSptSemverConfig(semver);
    setCacheInfo(cache);
    setMaxDownloadsSel(simultaneos);
  }

  async function mudarLimiteCache(gb: number) {
    try {
      setCacheInfo(await window.modManagerAPI.setDownloadCacheLimit(gb));
    } catch {
      // Fica o valor anterior no seletor.
    }
  }

  async function limparCache() {
    setLimpandoCache(true);
    try {
      const r = await window.modManagerAPI.clearDownloadCache();
      setCacheInfo(r);
      pushToast(r.kept > 0 ? t("settings.cacheClearedInUse", { count: r.kept }) : t("settings.cacheCleared"), true);
    } catch {
      pushToast(t("settings.cacheClearFailed"), false);
    } finally {
      setLimpandoCache(false);
    }
  }

  async function verificarAtualizacaoDoApp() {
    setChecagemApp("checking");
    try {
      const info = await window.modManagerAPI.checkAppUpdate();
      setAppUpdate(info);
      // Se a pessoa tinha dispensado o aviso e pediu pra checar de novo, mostra.
      setUpdateDismissed(false);
      setChecagemApp("done");
    } catch {
      setChecagemApp("failed");
    }
  }

  const [sptPath, setSptPath] = useState<string | null>(null);
  const [serverRoot, setServerRoot] = useState<string | null>(null);
  const [isSplitInstance, setIsSplitInstance] = useState(false);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  // Filtro de Fika na lista de INSTALADOS (pedido do FlachkopfLarry). A marcação
  // vem do catálogo, então só vale pra mod que o app sabe qual é lá (forgeModId).
  const [fikaFilter, setFikaFilter] = useState<FikaFilter>("all");
  const [fikaById, setFikaById] = useState<Record<string, boolean | null>>({});
  const [fikaLoading, setFikaLoading] = useState(false);
  const [launchTargets, setLaunchTargets] = useState<{ server: boolean; launcher: boolean }>({ server: false, launcher: false });
  const [refreshing, setRefreshing] = useState(false);
  // "Vincular à página do mod" (pedido do raydenx).
  const [perfis, setPerfis] = useState<{ active: string; profiles: ModProfileSummary[] } | null>(null);
  // Caixa de texto genérica (nome de perfil novo, renomear perfil).
  const [pedido, setPedido] = useState<{
    titulo: string;
    dica: string;
    valor: string;
    /** Aceita texto vazio (ex.: apagar a versão informada). */
    vazioOk: boolean;
    responder: (v: string | null) => void;
  } | null>(null);
  const pedirTexto = (titulo: string, dica: string, valor: string, vazioOk = false) =>
    new Promise<string | null>((resolve) => setPedido({ titulo, dica, valor, vazioOk, responder: resolve }));
  const [linkDialog, setLinkDialog] = useState<{ parts: ModInfo[]; name: string; ref: string; version: string; saving: boolean } | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [compareResult, setCompareResult] = useState<{ missing: string[]; extra: string[] } | null>(null);
  const [sptVersion, setSptVersion] = useState<string | undefined>(undefined);
  const [conflictReport, setConflictReport] = useState<ConflictReport | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [sptVersionInput, setSptVersionInput] = useState("");
  const [forgeResult, setForgeResult] = useState<ForgeUpdateCheckResult | null>(null);
  const [checkingForgeUpdates, setCheckingForgeUpdates] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeStatusByName, setForgeStatusByName] = useState<
    Map<string, ForgeStatusInfo>
  >(new Map());
  const [forgeSptVersions, setForgeSptVersions] = useState<ForgeSptVersion[]>([]);
  const [forgeCheckedAt, setForgeCheckedAt] = useState<string | null>(null);

  const [browseOpen, setBrowseOpen] = useState(false);
  /**
   * Dependências por chave `id:versao`, preenchido em lote depois de cada busca.
   * Serve pro selo na linha do resultado: avisa que existe vínculo ANTES do
   * clique, em vez de só no diálogo.
   */
  const [depsPorChave, setDepsPorChave] = useState<Record<string, ModDependencyInfo[]>>({});
  /**
   * Confirmação dentro do app, no lugar do window.confirm.
   *
   * O diálogo nativo quebrava a busca: no Windows, depois de um window.confirm
   * os campos de texto do Electron param de aceitar foco até a janela perder e
   * recuperar o foco. Três pessoas relataram o sintoma, cada uma de um jeito
   * ("buscar, remover, a barra fica inútil"), e uma delas notou que Alt+Tab
   * resolvia, que é exatamente a janela perdendo e recuperando o foco.
   */
  const [confirmacao, setConfirmacao] = useState<{ texto: string; responder: (ok: boolean) => void } | null>(null);

  // Caixa de erro: o texto traduzido em cima, e o relato pronto pra copiar embaixo.
  const [erroAberto, setErroAberto] = useState<{ texto: string; relato: string; raw: string } | null>(null);
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [erroCopiado, setErroCopiado] = useState(false);

  async function abrirErro(texto: string, raw: string) {
    // Busca uma vez só: versão do app e sistema não mudam com o app aberto.
    const diag = diagnostico ?? (await window.modManagerAPI.getDiagnostics());
    if (!diagnostico) setDiagnostico(diag);
    setErroCopiado(false);
    // A versão do SPT vem do SPT.Server.exe (4.1.6). O sptVersion do cabeçalho
    // não serve aqui: no SPT 4.x ele cai na versão do JOGO ("Tarkov 0.16.9..."),
    // e o relato saía "SPT Tarkov 0.16.9", que não responde qual SPT a pessoa usa.
    const sptSemver = await window.modManagerAPI.getSptSemver().catch(() => undefined);
    setErroAberto({ texto, raw, relato: montaRelato(raw, diag, sptSemver || sptVersionInput.trim() || undefined) });
  }

  async function copiarErro() {
    if (!erroAberto) return;
    const r = await window.modManagerAPI.copyText(erroAberto.relato);
    // Se falhar, o texto continua selecionável na caixa: nada se perde.
    if (r.success) {
      setErroCopiado(true);
      window.setTimeout(() => setErroCopiado(false), 2000);
    }
  }
  const confirmar = useCallback(
    (texto: string) => new Promise<boolean>((resolve) => setConfirmacao({ texto, responder: resolve })),
    []
  );
  const [depPrompt, setDepPrompt] = useState<{
    mod: ForgeCatalogMod;
    version: { id: number; version: string; link: string };
    deps: ModDependencyInfo[];
  } | null>(null);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseCategory, setBrowseCategory] = useState("");
  const [browseSort, setBrowseSort] = useState<"-downloads" | "-updated_at" | "-created_at" | "name">("-downloads");
  const [modSources, setModSources] = useState<ModSourceInfo[]>([]);
  const [activeSourceKey, setActiveSourceKey] = useState("");
  const [browseCategories, setBrowseCategories] = useState<ForgeCategory[]>([]);
  const [browseCompat, setBrowseCompat] = useState<CompatFilter>("all");
  const [browseHideInstalled, setBrowseHideInstalled] = useState(false);
  const [browseFikaOnly, setBrowseFikaOnly] = useState(false);
  const [browseResults, setBrowseResults] = useState<ForgeCatalogMod[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLastPage, setBrowseLastPage] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [selectedVersionByModId, setSelectedVersionByModId] = useState<Map<number, number>>(new Map());
  // Vários de uma vez agora que existe fila: cada linha do Navegar sabe se é dela.
  const [installingModIds, setInstallingModIds] = useState<Set<number>>(new Set());
  function marcarInstalando(id: number, sim: boolean) {
    setInstallingModIds((prev) => {
      const next = new Set(prev);
      if (sim) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  interface QueueItem {
    id: string;
    name: string;
    status: "queued" | "active" | "done" | "error" | "cancelled";
    receivedBytes?: number;
    totalBytes?: number;
    startedAt?: number;
    message?: string;
    raw?: string;
    /** Veio do cache de downloads: não teve download, só instalação. */
    fromCache?: boolean;
  }
  const [downloadQueue, setDownloadQueue] = useState<QueueItem[]>([]);

  // Checagem de atualização do próprio app — roda uma vez na abertura. Só notifica;
  // baixar/instalar continua sendo decisão (e ação) da pessoa, no navegador.
  const [forgeProgress, setForgeProgress] = useState<{ done: number; total: number } | null>(null);
  const [lookupInProgress, setLookupInProgress] = useState(false);
  const [installProgress, setInstallProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    const unsubscribe = window.modManagerAPI.onForgeCheckProgress(setForgeProgress);
    return unsubscribe;
  }, []);

  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => {
    window.modManagerAPI.checkAppUpdate().then(setAppUpdate);
  }, []);

  // A fila de verdade mora no backend (um download por vez, instalação sempre
  // sozinha). Aqui só se espelha o que ele manda.
  const [filaBackend, setFilaBackend] = useState<DownloadQueueJob[]>([]);
  // Recolhida: só o cabeçalho, pra não cobrir a janela do Navegar.
  const [filaRecolhida, setFilaRecolhida] = useState(false);
  useEffect(() => {
    void window.modManagerAPI.getDownloadQueue().then(setFilaBackend).catch(() => undefined);
    return window.modManagerAPI.onDownloadQueue(setFilaBackend);
  }, []);

  /**
   * Dependência -> mod principal que entrou na fila junto com ela. Cancelar a
   * dependência pergunta se cancela o principal também: às vezes a pessoa só
   * quer a dependência (é um fix sozinha), às vezes não quer nenhum dos dois.
   */
  const principalDoJob = useRef(new Map<string, { nome: string; jobId: string }>());
  const [perguntaLote, setPerguntaLote] = useState<{ jobId: string; dep: string; principal: string; principalJobId: string } | null>(
    null
  );

  function novoJobId(): string {
    return `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function controlarDownload(acao: "pause" | "resume" | "up" | "down", job: DownloadQueueJob) {
    void window.modManagerAPI.controlDownload(acao, job.id);
  }

  function cancelarDownload(job: DownloadQueueJob) {
    const principal = principalDoJob.current.get(job.id);
    // Só pergunta se o principal ainda está na fila: já instalado, não há o que cancelar.
    if (principal && filaBackend.some((j) => j.id === principal.jobId && j.state !== "installing")) {
      setPerguntaLote({ jobId: job.id, dep: job.name, principal: principal.nome, principalJobId: principal.jobId });
      return;
    }
    void window.modManagerAPI.controlDownload("cancel", job.id);
  }

  function responderPerguntaLote(cancelarPrincipal: boolean) {
    if (!perguntaLote) return;
    void window.modManagerAPI.controlDownload("cancel", perguntaLote.jobId);
    if (cancelarPrincipal) void window.modManagerAPI.controlDownload("cancel", perguntaLote.principalJobId);
    setPerguntaLote(null);
  }

  function cancelarFila() {
    void window.modManagerAPI.cancelWaitingDownloads();
  }

  /** Mostra o fim de um download da fila por alguns segundos. */
  function registrarFimDownload(id: string, nome: string, result: InstallResult) {
    principalDoJob.current.delete(id);
    const status: QueueItem["status"] = result.cancelled ? "cancelled" : result.success ? "done" : "error";
    setDownloadQueue((prev) => [
      ...prev,
      {
        id,
        name: nome,
        status,
        message: result.cancelled ? undefined : tMsg(result.message),
        raw: result.message,
        fromCache: result.fromCache
      }
    ]);
    setTimeout(() => setDownloadQueue((prev) => prev.filter((q) => q.id !== id)), status === "error" ? 6000 : 3000);
  }

  function pushQueueItem(name: string): string {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDownloadQueue((prev) => [...prev, { id, name, status: "queued" }]);
    return id;
  }
  function markQueueActive(id: string) {
    setDownloadQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "active", startedAt: Date.now() } : q)));
  }
  function markQueueDone(id: string, success: boolean, message?: string, raw?: string) {
    setDownloadQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: success ? "done" : "error", message, raw } : q))
    );
    // Some da lista sozinho depois de um tempo, sem precisar de ação manual — erro fica
    // visível um pouco mais que sucesso, já que é mais provável que a pessoa queira ler.
    setTimeout(
      () => {
        setDownloadQueue((prev) => prev.filter((q) => q.id !== id));
      },
      success ? 3000 : 6000
    );
  }
  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  const pushToast = useCallback((text: string, ok: boolean, raw?: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, ok, raw: ok ? undefined : raw }]);
    // 4s era pouco pra erro: o pessoal tirava print no meio da animação e o relato
    // chegava cortado. Erro com "Detalhes" fica o bastante pra alguém clicar.
    setTimeout(
      () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      !ok && relatavel(raw) ? 12000 : 4000
    );
  }, []);

  const refreshMods = useCallback(async () => {
    const list = await window.modManagerAPI.scanMods();
    setMods(list);
    return list;
  }, []);

  // Fecha o menu de ações aberto ao clicar fora dele.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".action-menu-wrapper")) setOpenMenuKey(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const summary = useMemo(() => {
    const server = mods.filter((m) => m.type === "server").length;
    const client = mods.filter((m) => m.type === "client").length;
    const active = mods.filter((m) => m.enabled).length;
    const disabled = mods.length - active;
    return { total: mods.length, server, client, active, disabled };
  }, [mods]);

  const filteredMods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = mods.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      // O filtro de tipo NÃO entra aqui: ele é aplicado depois do agrupamento,
      // em buildModTree. Podar antes desmontaria pacotes mistos — a metade
      // server sumiria da lista e o pai perderia o nome, que é calculado sobre
      // o pacote inteiro.
      if (statusFilter === "enabled" && !m.enabled) return false;
      if (statusFilter === "disabled" && m.enabled) return false;
      if (originFilter === "manual" && !m.installedManually) return false;
      if (originFilter === "manager" && m.installedManually) return false;
      if (fikaFilter !== "all") {
        if (m.forgeModId === undefined) return false;
        const fika = fikaById[String(m.forgeModId)];
        if (fikaFilter === "compatible" && fika !== true) return false;
        if (fikaFilter === "incompatible" && fika !== false) return false;
      }
      return true;
    });

    // Comparação natural: "Mod 10" depois de "Mod 2" (e não antes, como daria a
    // comparação de texto pura), e sem diferenciar maiúscula de minúscula — senão
    // "Zebra" vinha antes de "apple".
    const byName = (a: ModInfo, b: ModInfo) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

    // Quem precisa de ação primeiro: atualização disponível > bloqueada >
    // incompatível > só informativo > sem status conhecido.
    const forgeRank = (mod: ModInfo) => {
      const status = forgeStatusByName.get(mod.name)?.status;
      return status === "update" ? 0 : status === "blocked" ? 1 : status === "incompatible" ? 2 : status === "info" ? 3 : 4;
    };

    const sorted = [...filtered].sort((a, b) => {
      // Mods sem data de instalação (os instalados por fora do app) não têm onde
      // se encaixar numa ordem cronológica — vão sempre pro fim, nos dois sentidos,
      // em vez de fingir que são os "mais antigos".
      if (sortField === "installedAt") {
        const da = a.installedAt ?? "";
        const db = b.installedAt ?? "";
        if (!da !== !db) return da ? -1 : 1;
        if (!da && !db) return byName(a, b);
      }

      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = byName(a, b);
          break;
        case "status":
          cmp = Number(b.enabled) - Number(a.enabled) || byName(a, b);
          break;
        case "origin":
          cmp = Number(a.installedManually) - Number(b.installedManually) || byName(a, b);
          break;
        case "installedAt":
          cmp = (a.installedAt ?? "").localeCompare(b.installedAt ?? "") || byName(a, b);
          break;
        case "forge":
          cmp = forgeRank(a) - forgeRank(b) || byName(a, b);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [mods, searchQuery, statusFilter, originFilter, fikaFilter, fikaById, sortField, sortDirection, forgeStatusByName]);

  // Busca a marcação de Fika só quando o filtro é usado, e só dos ids que ainda
  // não tem: é uma consulta em lote por 50 mods, sem custo enquanto ninguém filtra.
  const fikaIdsFaltando = useMemo(() => {
    if (fikaFilter === "all") return [];
    const ids = new Set<number>();
    for (const m of mods) if (m.forgeModId !== undefined && !(String(m.forgeModId) in fikaById)) ids.add(m.forgeModId);
    return [...ids];
  }, [fikaFilter, mods, fikaById]);
  useEffect(() => {
    if (fikaIdsFaltando.length === 0) return;
    let vivo = true;
    setFikaLoading(true);
    window.modManagerAPI
      .fetchModFika(fikaIdsFaltando)
      .then((r) => {
        if (!vivo) return;
        // Quem não veio na resposta (rede caiu) vira null pra não pedir em loop.
        const completo: Record<string, boolean | null> = {};
        for (const id of fikaIdsFaltando) completo[String(id)] = r[String(id)] ?? null;
        setFikaById((prev) => ({ ...prev, ...completo }));
      })
      .finally(() => {
        if (vivo) setFikaLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [fikaIdsFaltando]);
  const semIdNoCatalogo = useMemo(() => mods.filter((m) => m.forgeModId === undefined).length, [mods]);

  const modTree = useMemo(() => buildModTree(filteredMods, typeFilter), [filteredMods, typeFilter]);

  // ---- Pacotes abertos/fechados ----
  // Morava dentro da lista, então qualquer re-render que recriava a lista
  // (reescanear, trocar filtro, agrupar por categoria) voltava tudo ao padrão:
  // o pacote que a pessoa fechou abria de novo. Agora fica aqui e é gravado.
  // Guarda só o que a pessoa ESCOLHEU; o resto segue o padrão (registrado
  // aberto, inferido fechado, porque um palpite não deve parecer certeza).
  const [pacotesAbertos, setPacotesAbertos] = useState<Record<string, boolean>>(() =>
    lerLocal(EXPANDED_STORAGE_KEY, {} as Record<string, boolean>, ehMapaDeBooleanos)
  );
  const pacoteAberto = useCallback(
    (node: ModTreeNode) => (node.single ? false : pacotesAbertos[node.key] ?? !node.inferred),
    [pacotesAbertos]
  );
  function definirPacotes(nodes: ModTreeNode[], aberto: boolean) {
    setPacotesAbertos((prev) => {
      const prox = { ...prev };
      for (const n of nodes) if (!n.single) prox[n.key] = aberto;
      gravarLocal(EXPANDED_STORAGE_KEY, prox);
      return prox;
    });
  }
  function alternarPacote(node: ModTreeNode) {
    definirPacotes([node], !pacoteAberto(node));
  }

  // ---- Categorias ----
  const [groupMode, setGroupMode] = useState<GroupMode>(() => lerLocal(GROUP_STORAGE_KEY, "none", ehModoGrupo));
  const [recolhidas, setRecolhidas] = useState<Set<string>>(
    () => new Set(lerLocal(COLLAPSED_STORAGE_KEY, [] as string[], ehListaDeTexto))
  );
  const [titulosFonte, setTitulosFonte] = useState<Record<string, string>>({});
  const [buscandoCategorias, setBuscandoCategorias] = useState(false);
  const [custom, setCustom] = useState<CustomCategories>({ categories: [], assign: {} });
  const [editandoCategoria, setEditandoCategoria] = useState<{ id: string; valor: string } | null>(null);
  // Modo de edição das categorias: fora dele a lista fica limpa, sem lápis,
  // setas, arrastar nem categoria vazia. Não é gravado: organizar é uma tarefa
  // de vez em quando, e a lista do dia a dia não deveria vir com as ferramentas
  // à mostra.
  const [editandoCategorias, setEditandoCategorias] = useState(false);
  const modoEdicao = groupMode === "custom" && editandoCategorias;
  // Ids que já foram perguntados à fonte, pra não repetir a cada reescaneamento.
  const idsPerguntados = useRef(new Set<number>());

  useEffect(() => {
    if (!sptPath) return;
    idsPerguntados.current = new Set();
    setTitulosFonte({});
    window.modManagerAPI.getCustomCategories().then(setCustom);
  }, [sptPath]);

  // Pergunta à fonte só pelos mods que ainda não tem categoria conhecida, e só
  // quando o agrupamento está ligado: quem usa a lista plana não gasta rede.
  useEffect(() => {
    if (groupMode === "none" || !sptPath) return;
    const novos = mods
      .map((m) => m.forgeModId)
      .filter((id): id is number => id !== undefined && !idsPerguntados.current.has(id));
    if (novos.length === 0) return;
    novos.forEach((id) => idsPerguntados.current.add(id));
    setBuscandoCategorias(true);
    window.modManagerAPI
      .fetchModCategories(novos)
      .then((titulos) => setTitulosFonte((prev) => ({ ...prev, ...titulos })))
      .catch(() => undefined)
      .finally(() => setBuscandoCategorias(false));
  }, [mods, groupMode, sptPath]);

  function salvarCustom(proximo: CustomCategories) {
    setCustom(proximo);
    window.modManagerAPI.saveCustomCategories(proximo).catch(() => undefined);
  }

  // Trocar o modo só troca a VISÃO. "Minhas categorias" e a da fonte são dados
  // separados: olhar a da fonte nunca mexe no que o usuário montou.
  function mudarAgrupamento(modo: GroupMode) {
    setGroupMode(modo);
    if (modo !== "custom") setEditandoCategorias(false);
    gravarLocal(GROUP_STORAGE_KEY, modo);
  }

  const grupos = useMemo(
    () => groupNodes(modTree, groupMode, titulosFonte, custom),
    [modTree, groupMode, titulosFonte, custom]
  );

  function chaveRecolhida(id: string) {
    return `${groupMode}|${id}`;
  }
  function alternarCategoria(id: string) {
    setRecolhidas((prev) => {
      const prox = new Set(prev);
      const k = chaveRecolhida(id);
      if (prox.has(k)) prox.delete(k);
      else prox.add(k);
      gravarLocal(COLLAPSED_STORAGE_KEY, [...prox]);
      return prox;
    });
  }
  // "Recolher tudo" age no nível de cima da lista: com agrupamento, fecha as
  // CATEGORIAS e não mexe nos pacotes de dentro (fechar os dois de uma vez
  // obrigava a reabrir pacote por pacote depois). Sem agrupamento, os pacotes
  // são o nível de cima, então é neles que ele age.
  const pacotesVisiveis = modTree.filter((n) => !n.single);
  const todasRecolhidas =
    groupMode !== "none"
      ? grupos.length > 0 && grupos.every((g) => recolhidas.has(chaveRecolhida(g.id)))
      : pacotesVisiveis.length > 0 && pacotesVisiveis.every((n) => !pacoteAberto(n));
  function alternarTodas() {
    const abrir = todasRecolhidas;
    if (groupMode === "none") {
      definirPacotes(pacotesVisiveis, abrir);
      return;
    }
    setRecolhidas((prev) => {
      const prox = new Set(prev);
      for (const g of grupos) {
        if (abrir) prox.delete(chaveRecolhida(g.id));
        else prox.add(chaveRecolhida(g.id));
      }
      gravarLocal(COLLAPSED_STORAGE_KEY, [...prox]);
      return prox;
    });
  }

  function criarCategoria() {
    const id = newCategoryId(t("categories.new"));
    salvarCustom({ ...custom, categories: [...custom.categories, { id, name: t("categories.new") }] });
    setEditandoCategoria({ id, valor: t("categories.new") });
  }

  function confirmarRenomeCategoria() {
    if (!editandoCategoria) return;
    salvarCustom(renameCategory(custom, editandoCategoria.id, editandoCategoria.valor));
    setEditandoCategoria(null);
  }

  async function apagarCategoria(id: string, nome: string) {
    if (!(await confirmar(t("categories.deleteConfirm", { name: nome })))) return;
    salvarCustom(removeCategory(custom, id));
  }

  // A árvore inteira, sem filtro: mover e conferir categoria precisam achar a
  // linha mesmo quando ela está escondida pela busca.
  const arvoreCompleta = useMemo(() => buildModTree(mods, "all"), [mods]);
  const linhaPorChave = useMemo(() => new Map(arvoreCompleta.map((n) => [n.key, n])), [arvoreCompleta]);

  function moverParaCategoria(nodeKeys: string[], categoriaId: string) {
    const linhas = nodeKeys.map((k) => linhaPorChave.get(k)).filter((n): n is ModTreeNode => !!n);
    salvarCustom(assignNodes(custom, linhas, categoriaId));
  }

  // Grava os outros nomes de cada linha que já tem categoria (id do catálogo,
  // GUID, pastas). É o que faz a categoria sobreviver a uma atualização, e
  // também converte o que foi organizado antes desta versão.
  useEffect(() => {
    if (custom.categories.length === 0 || arvoreCompleta.length === 0) return;
    const completo = withAliases(custom, arvoreCompleta);
    if (completo !== custom) salvarCustom(completo);
  }, [custom, arvoreCompleta]);

  // ---- Rolagem automática durante o arrasto ----
  // Enquanto um arrasto nativo está acontecendo, o Chromium (e portanto o
  // Electron) não entrega a rodinha do mouse pra página: não dá pra rolar e
  // soltar o mod numa categoria que está fora da tela. O jeito padrão, o mesmo
  // do Explorer e dos navegadores, é rolar sozinho quando o cursor chega perto
  // da borda de cima ou de baixo. Quanto mais perto da borda, mais rápido.
  // As faixas com seta (ver o JSX) mostram onde fica essa zona, pra pessoa
  // não precisar adivinhar.
  //
  // As faixas ficam SEMPRE no DOM e só trocam de classe, direto pelo ref, sem
  // passar pelo React. Qualquer re-render durante o arrasto (inserir as faixas,
  // guardar a zona num state) fazia o Chromium cancelar o arrasto na hora.
  const faixaCima = useRef<HTMLDivElement>(null);
  const faixaBaixo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ZONA = ZONA_ROLAGEM_PX;
    const VELOCIDADE_MAX = 28; // px por quadro
    let ativo = false;
    let y = 0;
    let quadro = 0;
    let zonaAtual: "up" | "down" | null = null;
    const marcaZona = (z: "up" | "down" | null) => {
      if (z === zonaAtual) return;
      zonaAtual = z;
      faixaCima.current?.classList.toggle("active", z === "up");
      faixaBaixo.current?.classList.toggle("active", z === "down");
    };
    const mostraFaixas = (visivel: boolean) => {
      faixaCima.current?.classList.toggle("visible", visivel);
      faixaBaixo.current?.classList.toggle("visible", visivel);
    };

    const passo = () => {
      if (!ativo) return;
      const altura = window.innerHeight;
      let delta = 0;
      if (y < ZONA) delta = -VELOCIDADE_MAX * ((ZONA - y) / ZONA);
      else if (y > altura - ZONA) delta = VELOCIDADE_MAX * ((y - (altura - ZONA)) / ZONA);
      marcaZona(delta < 0 ? "up" : delta > 0 ? "down" : null);
      if (delta !== 0) window.scrollBy(0, delta);
      quadro = requestAnimationFrame(passo);
    };
    const inicio = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer?.types.includes(ARRASTO_MOD)) return;
      ativo = true;
      y = e.clientY;
      mostraFaixas(true);
      quadro = requestAnimationFrame(passo);
    };
    const move = (e: globalThis.DragEvent) => {
      if (ativo) y = e.clientY;
    };
    const fim = () => {
      if (!ativo) return;
      ativo = false;
      cancelAnimationFrame(quadro);
      marcaZona(null);
      mostraFaixas(false);
    };
    // Fase de CAPTURA no window: as categorias chamam stopPropagation no
    // dragover (pra não acordar a caixa de "soltar arquivo pra instalar"), e
    // escutando na borbulha o cursor sumia assim que entrava numa categoria.
    // Era por isso que a lista subia, mas não descia: o rodapé da tela quase
    // sempre está em cima de uma categoria.
    // O dragstart é o único na borbulha: na captura ele chega ANTES da linha
    // gravar o tipo do arrasto, e aí não dá pra saber se é um mod.
    window.addEventListener("dragstart", inicio);
    window.addEventListener("dragover", move, true);
    window.addEventListener("dragend", fim, true);
    window.addEventListener("drop", fim, true);
    return () => {
      fim();
      window.removeEventListener("dragstart", inicio);
      window.removeEventListener("dragover", move, true);
      window.removeEventListener("dragend", fim, true);
      window.removeEventListener("drop", fim, true);
    };
  }, []);

  // ---- Arrastar mod pra categoria ----
  // Tipo próprio no dataTransfer: é o que separa este arrastar do arrastar de
  // ARQUIVO pra instalar, que a janela inteira escuta.
  const [alvoDoArrasto, setAlvoDoArrasto] = useState<string | null>(null);
  function soltarNaCategoria(e: DragEvent, categoriaId: string) {
    const chave = e.dataTransfer.getData(ARRASTO_MOD);
    if (!chave) return;
    e.preventDefault();
    e.stopPropagation();
    setAlvoDoArrasto(null);
    // Arrastou uma linha que está selecionada: leva a seleção inteira junto,
    // igual a qualquer gerenciador de arquivos.
    const selecionadas = chavesDeLinhaSelecionadas();
    const chaves = selecionadas.includes(chave) ? selecionadas : [chave];
    moverParaCategoria(chaves, categoriaId);
    if (chaves.length > 1) clearSelection();
  }

  /** Chaves de linha da árvore das partes selecionadas (a seleção é por mod). */
  function chavesDeLinhaSelecionadas(): string[] {
    const out: string[] = [];
    for (const node of arvoreCompleta) {
      if (node.parts.some((p) => selectedKeys.has(selectionKey(p)))) out.push(node.key);
    }
    return out;
  }

  const typeFilterOptions = useMemo(() => {
    const base: TypeFilter[] = ["all", "server", "client"];
    // Híbrido/desconhecido só ocupa espaço quando a instalação tem algum.
    if (mods.some((m) => m.type === "hybrid")) base.push("hybrid");
    if (mods.some((m) => m.type === "unknown")) base.push("unknown");
    return base;
  }, [mods]);

  // Conta MODS, não pastas: com 136 mods, um chip dizendo 190 confundiria.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of typeFilterOptions) {
      counts[option] = buildModTree(filteredMods, option as TypeFilter).length;
    }
    return counts;
  }, [filteredMods, typeFilterOptions]);

  const filtersActive = searchQuery.trim() !== "" || typeFilter !== "all" || statusFilter !== "all" || originFilter !== "all";

  function clearFilters() {
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
    setOriginFilter("all");
    setFikaFilter("all");
  }

  useEffect(() => {
    (async () => {
      const instance = await window.modManagerAPI.getSptPath();
      setSptPath(instance?.path ?? null);
      if (!instance?.path) {
        let jaViu = false;
        try {
          jaViu = localStorage.getItem(WELCOMED_STORAGE_KEY) === "1";
        } catch {
          // segue como primeira vez
        }
        if (!jaViu) setBoasVindas(true);
      }
      setServerRoot(instance?.serverRoot ?? null);
      setIsSplitInstance(instance?.split ?? false);
      if (instance?.path) {
        refreshMods();
        window.modManagerAPI.getLaunchTargets().then(setLaunchTargets);
        window.modManagerAPI.listProfiles().then(setPerfis);
        setSptVersion(await window.modManagerAPI.getSptVersion());
        // A escolha do usuário vem PRIMEIRO. A detecção é palpite bom, mas quem
        // roda 4.0.13 de propósito (mais mods disponíveis) precisa que a escolha
        // dele sobreviva ao reinício. Enquanto a detecção falhava no 4.x, o
        // else abaixo cobria isso por acidente; agora que ela funciona, a ordem
        // tem que ser explícita. O backend já resolve assim (override ?? detectado).
        const override = await window.modManagerAPI.getSptVersionOverride();
        const semver = await window.modManagerAPI.getSptSemver();
        if (override) setSptVersionInput(override);
        else if (semver) setSptVersionInput(semver);

        window.modManagerAPI.getForgeSptVersions().then(setForgeSptVersions);
        window.modManagerAPI.getModSources().then((r) => {
          setModSources(r.sources);
          setActiveSourceKey(r.activeKey);
        });

        const cache = await window.modManagerAPI.getForgeCache();
        if (cache.statusCache) {
          const restored = new Map(cache.statusCache.map((entry) => [entry.name, { status: entry.status, version: entry.version, blockedBy: entry.blockedBy }]));
          setForgeStatusByName(restored);
        }
        setForgeCheckedAt(cache.checkedAt);
      }
    })();
  }, [refreshMods]);

  async function handleChangeSource(key: string) {
    if (key === activeSourceKey) return;
    const anterior = activeSourceKey;
    setActiveSourceKey(key);
    const result = await window.modManagerAPI.setModSource(key);
    if (!result.success) {
      // Volta pro que estava: o backend não trocou (a fonte não respondeu ao
      // ping), então deixar o dropdown na nova mentiria sobre o estado real.
      setActiveSourceKey(anterior);
      pushToast(tMsg(result.message) || t("toast.sourceFailed"), false, result.message);
      return;
    }
    // Categorias e ids são POR FONTE — o que estava na tela é da fonte antiga.
    setBrowseCategories([]);
    setBrowseCategory("");
    setBrowseResults([]);
    window.modManagerAPI.getForgeCategories().then(setBrowseCategories);
    runForgeSearch(1);
  }

  async function handleSelectFolder() {
    const result = await window.modManagerAPI.selectSptFolder();
    if (result.success && result.path) {
      setSptPath(result.path);
      setServerRoot(result.serverRoot ?? result.path);
      setIsSplitInstance(result.split ?? false);
      pushToast(tMsg(result.message) || t("toast.instanceConfigured"), true);
      refreshMods();
      // Perfis e executáveis são da instância: os da anterior não valem aqui.
      void carregarPerfis();
      window.modManagerAPI.getLaunchTargets().then(setLaunchTargets);
      setSptVersion(await window.modManagerAPI.getSptVersion());
      // Instância NOVA: a escolha manual salva era da anterior, então é descartada
      // aqui. Se ficasse guardada, o próximo boot a ressuscitaria por cima da
      // detecção desta instalação — e aí a versão errada voltaria sozinha.
      const semver = await window.modManagerAPI.getSptSemver();
      window.modManagerAPI.setSptVersionOverride("");
      setSptVersionInput(semver || "");
      // Sem isso, o dropdown de versão do SPT ficava só com o placeholder na primeira
      // vez que alguém selecionava a pasta — só populava depois de fechar e reabrir o
      // app (quando o efeito de inicialização, que já buscava isso, finalmente rodava
      // com um sptPath salvo).
      window.modManagerAPI.getForgeSptVersions().then(setForgeSptVersions);
    } else {
      pushToast(tMsg(result.message) || t("toast.folderSelectFailed"), false, result.message);
    }
  }

  function handleOpenModHub() {
    window.modManagerAPI.openModHub();
  }

  const confirmResolverRef = useRef<((result: InstallResult) => void) | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ tmpDir: string; archivePath: string; rootEntries: string[] } | null>(null);

  // Ponto único por onde toda instalação passa. Se o backend responder pedindo
  // confirmação (estrutura de arquivo incomum), abre o modal e "pausa" aqui até o
  // usuário decidir — quem chamou só recebe o resultado final (instalado ou cancelado).
  // Uma pergunta de "arquivo estranho" por vez: com a fila, dois downloads podem
  // pedir confirmação quase juntos, e o segundo sobrescrevia o primeiro.
  const filaConfirmacao = useRef<Promise<unknown>>(Promise.resolve());
  async function installArchiveWithConfirmFlow(installCall: Promise<InstallResult>): Promise<InstallResult> {
    const result = await installCall;
    if (!result.needsConfirmation || !result.tmpDir) return result;
    const vez = filaConfirmacao.current.then(
      () =>
        new Promise<InstallResult>((resolve) => {
          confirmResolverRef.current = resolve;
          setPendingConfirm({ tmpDir: result.tmpDir!, archivePath: result.archivePath ?? "", rootEntries: result.rootEntries ?? [] });
        })
    );
    filaConfirmacao.current = vez.catch(() => undefined);
    return vez;
  }

  async function handleConfirmProceed() {
    if (!pendingConfirm) return;
    const { tmpDir, archivePath } = pendingConfirm;
    setPendingConfirm(null);
    const result = await window.modManagerAPI.confirmUnrecognizedInstall(tmpDir, archivePath);
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
  }

  async function handleConfirmAbort() {
    if (!pendingConfirm) return;
    const { tmpDir } = pendingConfirm;
    setPendingConfirm(null);
    const result = await window.modManagerAPI.abortUnrecognizedInstall(tmpDir);
    confirmResolverRef.current?.({ success: false, message: result.message });
    confirmResolverRef.current = null;
  }

  async function handleInstall() {
    setLoading(true);
    const previousKeys = new Set(mods.map(selectionKey));
    const result = await installArchiveWithConfirmFlow(window.modManagerAPI.installMod());
    pushToast(tMsg(result.message), result.success, result.message);
    setLoading(false);
    if (result.success) {
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setDragCounter((c) => c + 1);
      setIsDraggingFile(true);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragCounter((c) => {
      const next = c - 1;
      if (next <= 0) setIsDraggingFile(false);
      return Math.max(next, 0);
    });
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDraggingFile(false);
    setDragCounter(0);
    // Soltar um mod fora de uma categoria não é instalar arquivo nenhum.
    if (!e.dataTransfer.types.includes("Files")) return;

    const files = Array.from(e.dataTransfer.files);
    const archives = files.filter((f) => /\.(zip|7z|rar)$/i.test(f.name));

    if (archives.length === 0) {
      pushToast(t("toast.dropInvalidFile"), false);
      return;
    }

    setLoading(true);
    const previousKeys = new Set(mods.map(selectionKey));
    let successCount = 0;
    // Pré-popula a fila com todos os arquivos de uma vez, pra já mostrar o que vem a seguir
    // — sem isso, um lote de vários arquivos processava em silêncio, um de cada vez.
    const queueIds = archives.map((file) => pushQueueItem(file.name));
    for (let i = 0; i < archives.length; i++) {
      const file = archives[i];
      const queueId = queueIds[i];
      // @ts-expect-error o Electron injeta `.path` no objeto File nativo, fora da tipagem padrão do DOM
      const filePath: string | undefined = file.path;
      if (!filePath) {
        markQueueDone(queueId, false, t("queue.noFilePath"));
        continue;
      }
      markQueueActive(queueId);
      const result = await installArchiveWithConfirmFlow(window.modManagerAPI.installModFromPath(filePath));
      if (result.success) successCount++;
      markQueueDone(queueId, result.success, tMsg(result.message), result.message);
      pushToast(tMsg(result.message), result.success, result.message);
    }
    setLoading(false);
    if (successCount > 0) {
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
  }

  async function handleToggle(mod: ModInfo) {
    setMutating(true);
    const result = await window.modManagerAPI.toggleMod(mod);
    pushToast(tMsg(result.message), result.success, result.message);
    if (result.success) {
      // Atualização local (sem re-escanear o disco inteiro) — bem mais rápido com muitos mods.
      //
      // Inclui as OUTRAS PARTES do mesmo pacote: o backend alterna todas juntas, e sem
      // isso a lista continuava mostrando a outra metade no estado antigo — parecia que
      // a cascata não tinha funcionado.
      setMods((prev) =>
        prev.map((m) => {
          const isSame = m.id === mod.id && m.type === mod.type;
          const isSamePackage = !!mod.packageId && m.packageId === mod.packageId;
          return isSame || isSamePackage ? { ...m, enabled: !mod.enabled } : m;
        })
      );
    }
    setMutating(false);
  }

  async function handleUninstall(mod: ModInfo) {
    const confirmed = await confirmar(t("toast.confirmRemove", { name: mod.name }));
    if (!confirmed) return;
    setMutating(true);
    const result = await window.modManagerAPI.uninstallMod(mod);
    pushToast(tMsg(result.message), result.success, result.message);
    if (result.success) {
      const key = selectionKey(mod);
      forgetForgeStatus([mod.name]);
      setMods((prev) => prev.filter((m) => selectionKey(m) !== key));
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      // Remover uma parte leva as irmãs junto, e a filtragem acima só conhece a
      // que foi clicada — sem re-escanear, a outra metade continuava na lista
      // depois de já ter saído do disco. O caminho em lote já fazia isto; o
      // individual não, e a diferença só aparecia em mod de duas partes.
      if (mod.packageId || mod.packageSiblings?.length) await refreshMods();
    }
    setMutating(false);
  }

  async function handleOpenFolder(mod: ModInfo) {
    const result = await window.modManagerAPI.openModFolder(mod);
    if (!result.success) pushToast(tMsg(result.message), false, result.message);
  }

  async function handleReinstall() {
    pushToast(t("toast.selectUpdatedFile"), true);
    await handleInstall();
  }

  async function handleExportList() {
    const result = await window.modManagerAPI.exportProfile();
    pushToast(tMsg(result.message), result.success, result.message);
  }

  /**
   * Abre a página do mod na fonte. O endereço é resolvido lá no processo
   * principal, porque a URL precisa do slug e o registro só guarda o id.
   */
  function handleOpenModPage(modId: number) {
    void window.modManagerAPI.openForgeModPage(modId).then((r) => {
      if (!r.success && r.message) pushToast(tMsg(r.message), false, r.message);
    });
  }

  /**
   * Relê a pasta do SPT. Pedido do Aellitus: com o app aberto por horas, mod
   * colocado na pasta por fora só aparecia fechando e abrindo de novo.
   */
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const lista = await refreshMods();
      setLaunchTargets(await window.modManagerAPI.getLaunchTargets());
      await carregarPerfis();
      pushToast(t("toast.listRefreshed", { count: lista.length }), true);
    } finally {
      setRefreshing(false);
    }
  }

  // F5 relê a lista, como em qualquer gerenciador de arquivos.
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    if (sptPath) void handleRefresh();
  };
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "F5") return;
      e.preventDefault();
      refreshRef.current();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  async function handleLaunch(alvo: "server" | "launcher") {
    const r = await window.modManagerAPI.launchSpt(alvo);
    pushToast(tMsg(r.message), r.success, r.message);
  }

  function openLinkDialog(node: ModTreeNode) {
    const principal = node.parts[0];
    setLinkDialog({ parts: node.parts, name: node.name, ref: "", version: principal.versionManual ? principal.version ?? "" : "", saving: false });
  }

  async function confirmLinkDialog() {
    if (!linkDialog || linkDialog.saving) return;
    setLinkDialog({ ...linkDialog, saving: true });
    // Todas as partes do pacote apontam pra mesma página: a checagem procura
    // cada pasta pelo próprio nome, e uma parte sem vínculo seria procurada
    // (e talvez casada errado) por conta própria.
    let resultado: { success: boolean; message: string } = { success: false, message: "" };
    for (const parte of linkDialog.parts) {
      resultado = await window.modManagerAPI.setManualForgeMatch(parte.originalName, linkDialog.ref, linkDialog.version || undefined);
      if (!resultado.success) break;
    }
    if (!resultado.success) {
      setLinkDialog((d) => (d ? { ...d, saving: false } : d));
      pushToast(tMsg(resultado.message), false, resultado.message);
      return;
    }
    setLinkDialog(null);
    forgetForgeStatus(linkDialog.parts.map((p) => p.name));
    pushToast(tMsg(resultado.message), true);
    await refreshMods();
  }

  /**
   * Só a versão (pedido do raydenx): pra mod que o app já reconhece certo no
   * catálogo mas que não informa a versão. Vale pra todas as partes do pacote.
   */
  async function informarVersao(node: ModTreeNode) {
    const principal = node.parts[0];
    const atual = principal.versionManual ? principal.version ?? "" : "";
    const versao = await pedirTexto(t("version.title", { name: node.name }), t("version.hint"), atual, true);
    if (versao === null) return;
    let r: { success: boolean; message: string } = { success: true, message: "" };
    for (const parte of node.parts) {
      r = await window.modManagerAPI.setManualVersion(parte.originalName, versao);
      if (!r.success) break;
    }
    pushToast(tMsg(r.message), r.success, r.success ? undefined : r.message);
    forgetForgeStatus(node.parts.map((p) => p.name));
    await refreshMods();
  }

  async function handleClearLink(node: ModTreeNode) {
    for (const parte of node.parts) await window.modManagerAPI.clearManualForgeMatch(parte.originalName);
    forgetForgeStatus(node.parts.map((p) => p.name));
    pushToast(t("toast.linkRemoved"), true);
    await refreshMods();
  }

  // ---- Perfis de mods (ver electron/profiles.ts) ----
  async function carregarPerfis() {
    setPerfis(await window.modManagerAPI.listProfiles());
  }

  /**
   * Procura no catálogo e instala, em ordem, os mods de uma lista. Era o miolo
   * do "Importar lista"; agora serve também à troca de perfil, quando o perfil
   * tem mods que não estão no disco.
   */
  async function baixarFaltando(entradas: { name: string; guid?: string; version?: string; id?: number }[]) {
    const previousKeys = new Set(mods.map(selectionKey));
    // Nomes podem repetir entre um mod de servidor e um de cliente (ex: "Wedge"
    // nos dois lados). Sem tirar as repetições, o mesmo mod era baixado duas vezes.
    const porNome = new Map<string, { name: string; guid?: string; version?: string; id?: number }>();
    for (const e of entradas) if (!porNome.has(e.name)) porNome.set(e.name, e);
    const targets = [...porNome.keys()];

    // Fase 1: uma busca em lote pra todos, com um cartão de resumo só.
    setLookupInProgress(true);
    const found = await window.modManagerAPI.findForgeDownloadsForNames([...porNome.values()]);
    setLookupInProgress(false);
    setForgeProgress(null);

    // Fase 2: tudo entra na fila de uma vez, mas cada um só INSTALA depois do
    // anterior: a ordem da lista continua sendo a ordem de instalação.
    const installable = targets.filter((name) => found[name]);
    const notFound = targets.filter((name) => !found[name]);
    let installedCount = 0;
    const failed: string[] = [];

    const idsImport = installable.map(() => novoJobId());
    const promessasImport = installable.map((name, i) => {
      const lookup = found[name]!;
      return installArchiveWithConfirmFlow(
        window.modManagerAPI.installForgeMod(
          idsImport[i],
          lookup.downloadLink,
          lookup.forgeName ?? name,
          {
            id: lookup.modId,
            name: lookup.forgeName,
            author: lookup.author,
            version: lookup.version,
            // A partir daqui esse mod é reconhecido por ID exato.
            guid: lookup.guid
          },
          i > 0 ? [idsImport[i - 1]] : []
        )
      );
    });
    for (let i = 0; i < installable.length; i++) {
      const name = installable[i];
      setInstallProgress({ done: i + 1, total: installable.length });
      const installResult = await promessasImport[i];
      registrarFimDownload(idsImport[i], found[name]!.forgeName ?? name, installResult);
      if (installResult.success) installedCount++;
      else if (!installResult.cancelled) failed.push(name);
    }
    setInstallProgress(null);

    const problems = [...notFound, ...failed];
    pushToast(
      problems.length === 0
        ? t("restore.allInstalled", { count: installedCount })
        : t("restore.partialInstalled", {
            installed: installedCount,
            // Numa lista grande, despejar 100+ nomes num toast não ajuda ninguém.
            notFound: problems.slice(0, 5).join(", ") + (problems.length > 5 ? t("restore.andMore", { count: problems.length - 5 }) : "")
          }),
      problems.length === 0
    );
    if (installedCount > 0) {
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
      void carregarPerfis();
    }
  }

  async function trocarPerfil(id: string) {
    if (!perfis || id === perfis.active || mutating) return;
    setMutating(true);
    let r: ProfileSwitchResult;
    try {
      r = await window.modManagerAPI.switchProfile(id);
    } finally {
      setMutating(false);
    }
    pushToast(
      r.failed.length > 0 ? t("profiles.switchFailedSome", { names: r.failed.slice(0, 5).join(", ") }) : tMsg(r.message),
      r.success,
      r.success ? undefined : r.message
    );
    await refreshMods();
    setCustom(await window.modManagerAPI.getCustomCategories());
    await carregarPerfis();
    if (r.missing.length > 0 || r.disabled.length > 0) {
      setCompareResult({ missing: r.missing.map((m) => m.name), extra: r.disabled });
    }
    if (r.missing.length > 0 && (await confirmar(t("profiles.confirmDownloadMissing", { count: r.missing.length })))) {
      await baixarFaltando(r.missing);
    }
  }

  async function criarPerfil() {
    const nome = await pedirTexto(t("profiles.newTitle"), t("profiles.newHint"), "");
    if (nome === null) return;
    const r = await window.modManagerAPI.createProfile(nome);
    pushToast(tMsg(r.message), r.success, r.success ? undefined : r.message);
    await carregarPerfis();
  }

  async function renomearPerfil() {
    const atual = perfis?.profiles.find((p) => p.id === perfis.active);
    if (!atual) return;
    const nome = await pedirTexto(t("profiles.renameTitle"), "", atual.name);
    if (nome === null || nome.trim() === atual.name) return;
    const r = await window.modManagerAPI.renameProfile(atual.id, nome);
    pushToast(tMsg(r.message), r.success, r.success ? undefined : r.message);
    await carregarPerfis();
  }

  async function apagarPerfil(id: string) {
    const alvo = perfis?.profiles.find((p) => p.id === id);
    if (!alvo || !(await confirmar(t("profiles.deleteConfirm", { name: alvo.name })))) return;
    const r = await window.modManagerAPI.deleteProfile(id);
    pushToast(tMsg(r.message), r.success, r.success ? undefined : r.message);
    await carregarPerfis();
  }

  async function handleImportList() {
    const result = await window.modManagerAPI.importProfile();
    if (result.message !== "Cancelled.") pushToast(tMsg(result.message), result.success, result.success ? undefined : result.message);
    if (!result.success || !result.id) return;
    await carregarPerfis();
    // Importar não aplica nada sozinho: a pessoa vê o que vem e decide.
    const trocar = await confirmar(
      t("profiles.importSwitchConfirm", { name: result.name ?? "", count: result.modCount ?? 0, missing: result.missingCount ?? 0 })
    );
    if (trocar) await trocarPerfil(result.id);
  }


  async function handleDetectConflicts() {
    setCheckingConflicts(true);
    const report = await window.modManagerAPI.detectConflicts();
    setConflictReport(report);
    setCheckingConflicts(false);
    const total = report.clientFileConflicts.length + report.duplicateServerNames.length;
    pushToast(total === 0 ? t("toast.noConflictsFound") : t("toast.conflictsFound", { count: total }), total === 0);
  }

  /**
   * Apaga o que a última verificação disse sobre estes mods.
   *
   * O mapa de status só era PREENCHIDO, nunca esvaziado — e é persistido no
   * disco. Então, depois de atualizar um mod, o número da versão mudava (isso
   * vem do disco) mas a etiqueta "atualização disponível" continuava ali, e
   * voltava até depois de fechar o app. Mesma história pra mod removido.
   *
   * A escolha aqui é limpar em vez de reconsultar a fonte: aviso ausente é
   * melhor que aviso errado, e ele reaparece sozinho na próxima verificação.
   * Reconsultar custaria uma requisição num momento em que o usuário só queria
   * remover ou atualizar algo.
   */
  function forgetForgeStatus(nomes: string[]) {
    if (nomes.length === 0) return;
    setForgeStatusByName((anterior) => {
      const proximo = new Map(anterior);
      let mudou = false;
      for (const nome of nomes) {
        if (proximo.delete(nome)) mudou = true;
      }
      if (!mudou) return anterior;
      persistForgeStatus(proximo);
      return proximo;
    });
  }

  function persistForgeStatus(map: Map<string, ForgeStatusInfo>) {
    const asArray: ForgeStatusCacheEntry[] = Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
    window.modManagerAPI.setForgeCache(asArray);
    setForgeCheckedAt(new Date().toISOString());
  }

  async function handleCheckForgeUpdates() {
    if (!sptVersionInput.trim()) {
      pushToast(t("toast.enterSptVersion"), false);
      return;
    }
    setCheckingForgeUpdates(true);
    setForgeError(null);
    const payload = mods.map((m) => ({ name: m.name, originalName: m.originalName, version: m.version, guid: m.guid }));
    const response = await window.modManagerAPI.checkForgeUpdates(payload, sptVersionInput.trim());
    setCheckingForgeUpdates(false);
    setForgeProgress(null);
    if (!response.success || !response.result) {
      const message = tMsg(response.message) || t("toast.forgeUpdateCheckFailed");
      setForgeError(message);
      pushToast(message, false, response.message);
      return;
    }
    setForgeResult(response.result);
    setAtualizadosNoPainel(new Set());

    const statusMap = new Map<string, ForgeStatusInfo>();
    for (const u of response.result.updates) {
      statusMap.set(u.name, { status: "update", version: u.recommendedVersion });
    }
    for (const b of response.result.blocked) {
      if (!statusMap.has(b.name)) statusMap.set(b.name, { status: "blocked", version: b.recommendedVersion, blockedBy: quemBloqueia(b) });
    }
    for (const i of response.result.incompatible) {
      if (!statusMap.has(i.name)) statusMap.set(i.name, { status: "incompatible" });
    }
    for (const info of response.result.infoOnly) {
      if (!statusMap.has(info.name)) statusMap.set(info.name, { status: "info", version: info.recommendedVersion });
    }
    setForgeStatusByName(statusMap);
    persistForgeStatus(statusMap);

    const total = response.result.updates.length;
    pushToast(total === 0 ? t("toast.forgeAllUpToDate") : t("toast.forgeUpdatesAvailable", { count: total }), true);
  }

  // Roda a checagem da Forge só pros mods que acabaram de entrar (comparando
  // a lista antes/depois da instalação), sem re-consultar os outros já
  // verificados. Silenciosamente não faz nada se não tiver uma versão do SPT
  // informada ainda (não dá pra checar sem isso).
  async function checkForgeForNewMods(previousKeys: Set<string>, updatedMods: ModInfo[]) {
    if (!sptVersionInput.trim()) return;
    const newMods = updatedMods.filter((m) => !previousKeys.has(selectionKey(m)));
    if (newMods.length === 0) return;

    const payload = newMods.map((m) => ({ name: m.name, originalName: m.originalName, version: m.version, guid: m.guid }));
    const response = await window.modManagerAPI.checkForgeUpdates(payload, sptVersionInput.trim());
    if (!response.success || !response.result) return;

    const next = new Map(forgeStatusByName);
    for (const u of response.result.updates) next.set(u.name, { status: "update", version: u.recommendedVersion });
    for (const b of response.result.blocked) {
      if (!next.has(b.name)) next.set(b.name, { status: "blocked", version: b.recommendedVersion, blockedBy: quemBloqueia(b) });
    }
    for (const i of response.result.incompatible) {
      if (!next.has(i.name)) next.set(i.name, { status: "incompatible" });
    }
    for (const info of response.result.infoOnly) {
      if (!next.has(info.name)) next.set(info.name, { status: "info", version: info.recommendedVersion });
    }
    setForgeStatusByName(next);
    persistForgeStatus(next);
  }

  // onlyCompatible entra como parâmetro porque o setState do React não vale na
  // mesma volta: marcar o checkbox e buscar no mesmo clique leria o valor ANTIGO
  // do estado e faria a busca com o filtro invertido.
  async function runForgeSearch(
    page: number,
    compat: CompatFilter = browseCompat,
    hideInstalled = browseHideInstalled,
    // Vem por parâmetro porque quem troca o seletor precisa buscar com o valor
    // novo, e o estado do React só reflete isso no render seguinte.
    sort = browseSort,
    fikaOnly = browseFikaOnly
  ) {
    setBrowseLoading(true);
    setBrowseError(null);
    // O try/finally existe porque o setBrowseLoading(false) ficava DEPOIS do
    // await: qualquer exceção (rede caindo, IPC rejeitando, limite de taxa da
    // fonte) pulava a linha e deixava o campo de busca desabilitado pra sempre,
    // até fechar e reabrir a janela. Erro tratado já voltava como
    // { success: false }; o que faltava era cobrir o que NÃO volta.
    let response: Awaited<ReturnType<typeof window.modManagerAPI.searchForgeMods>>;
    try {
      response = await window.modManagerAPI.searchForgeMods({
        query: browseQuery.trim() || undefined,
        categorySlug: browseCategory || undefined,
        sort,
        sptVersionConstraint: sptConstraintFor(compat, sptVersionInput),
        // A versão vai SEMPRE pra marcação, mesmo com o filtro desligado: é o
        // que permite ver a lista inteira e ainda saber o que serve na sua
        // instância.
        markVersion: sptVersionInput.trim() || undefined,
        // Esconder é filtro LOCAL sobre a página que o servidor mandou, e a API
        // não tem "só os que não tenho". Numa página de 24 quase tudo some pra
        // quem já tem muita coisa — a página 1 vem por downloads, justamente os
        // populares. Pedindo o máximo permitido, sobra lista depois de esconder.
        perPage: hideInstalled ? 50 : undefined,
        fikaOnly: fikaOnly || undefined,
        page
      });
    } catch (err) {
      setBrowseError(String(err instanceof Error ? err.message : err));
      return;
    } finally {
      setBrowseLoading(false);
    }
    if (!response.success || !response.result) {
      setBrowseError(tMsg(response.message) || t("toast.forgeSearchFailed"));
      return;
    }
    setBrowseResults(response.result.mods);
    // Uma requisição pra página inteira. O endpoint aceita as chaves separadas
    // por vírgula, então marcar 20 resultados custa o mesmo que marcar um.
    // Roda solto de propósito: a lista já apareceu, e o selo entra quando
    // chegar. Prender a busca a isso deixaria o catálogo mais lento por um
    // detalhe secundário.
    const chaves = response.result.mods
      .map((m) => {
        const vId = m.compatibleVersionId ?? m.versions[0]?.id;
        const v = m.versions.find((x) => x.id === vId);
        return v ? `${m.id}:${v.version}` : null;
      })
      .filter((c): c is string => c !== null);
    void window.modManagerAPI
      .fetchModDependenciesBatch(chaves)
      .then((mapa) => setDepsPorChave((anterior) => ({ ...anterior, ...mapa })))
      .catch(() => {
        /* sem selo é degrade aceitável: o diálogo no clique ainda protege */
      });
    // Escolhas manuais de versão são da busca ANTERIOR. Mantê-las fazia o filtro
    // parecer quebrado: marcar "só compatíveis", buscar de novo e continuar vendo
    // a versão escolhida antes, porque a escolha manual ganha do padrão.
    setSelectedVersionByModId(new Map());
    setBrowsePage(response.result.page);
    setBrowseLastPage(response.result.lastPage);
  }

  async function handleOpenBrowse() {
    setBrowseOpen(true);
    if (browseCategories.length === 0) {
      window.modManagerAPI.getForgeCategories().then(setBrowseCategories);
    }
    runForgeSearch(1);
  }

  function handleSelectVersion(modId: number, versionId: number) {
    setSelectedVersionByModId((prev) => new Map(prev).set(modId, versionId));
  }

  const [updatingModName, setUpdatingModName] = useState<string | null>(null);
  // Nomes já atualizados desde a última checagem: a linha troca o botão por um
  // "atualizado", e o "Atualizar todos" não baixa de novo.
  const [atualizadosNoPainel, setAtualizadosNoPainel] = useState<Set<string>>(new Set());
  const [atualizandoTodos, setAtualizandoTodos] = useState(false);

  // Atualiza sem sair do app: o link do resultado é o download direto da versão
  // recomendada, então dá pra passar pelo mesmo instalador usado na busca da Forge —
  // em vez de abrir o navegador e deixar o .zip no Downloads pra instalar na mão.
  /** Baixa e instala UMA atualização, sem reescanear. Devolve o resultado do backend. */
  async function instalarAtualizacao(u: ForgeUpdateItem, opts?: { id: string; after: string[] }) {
    const queueId = opts?.id ?? novoJobId();
    const result = await installArchiveWithConfirmFlow(
      window.modManagerAPI.installForgeMod(
        queueId,
        u.downloadLink!,
        u.name,
        {
          name: u.name,
          version: u.recommendedVersion,
          guid: u.guid
        },
        opts?.after ?? []
      )
    );
    registrarFimDownload(queueId, u.name, result);
    if (result.success) setAtualizadosNoPainel((prev) => new Set(prev).add(u.name));
    return result;
  }

  /** "Scorpion 1.0.0 (exige ~2.0.15), Outro 2.1" — pro hover e pro diálogo. */
  function quemBloqueia(b: ForgeUpdateItem): string | undefined {
    if (!b.blockingMods?.length) return undefined;
    return b.blockingMods
      .map((m) =>
        t(m.constraint ? "forge.blockingEntry" : "forge.blockingEntryNoConstraint", {
          name: m.name,
          version: m.version ?? "",
          constraint: m.constraint ?? ""
        }).replace(/\s+/g, " ")
      )
      .join(", ");
  }

  /**
   * "Atualizar mesmo assim" (pedido do Vorax). A fonte bloqueia porque um mod
   * instalado declara que não aceita a versão nova; às vezes o autor só não
   * atualizou a faixa. A decisão fica com a pessoa, depois de ver quem pode
   * quebrar. A resposta do bloqueio não traz link, então ele vem da lista de
   * versões do mod.
   */
  async function handleForceUpdate(b: ForgeUpdateItem) {
    if (!b.modId || !b.recommendedVersion) return;
    const quem = quemBloqueia(b) ?? t("forge.blockingUnknown");
    if (!(await confirmar(t("forge.forceConfirm", { name: b.name, version: b.recommendedVersion, who: quem })))) return;
    setUpdatingModName(b.name);
    const link = await window.modManagerAPI.resolveVersionLink(b.modId, b.recommendedVersion);
    setUpdatingModName(null);
    if (!link) {
      pushToast(t("forge.forceNoLink", { version: b.recommendedVersion }), false);
      return;
    }
    await handleInstallUpdate({ ...b, downloadLink: link });
  }

  async function handleInstallUpdate(u: ForgeUpdateItem) {
    setUpdatingModName(u.name);
    const previousKeys = new Set(mods.map(selectionKey));
    const result = await instalarAtualizacao(u);
    setUpdatingModName(null);
    if (!result.cancelled) pushToast(tMsg(result.message), result.success, result.message);
    if (result.success) {
      // A etiqueta antiga fala da versão que acabou de sair do disco.
      forgetForgeStatus([u.name]);
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
  }

  /**
   * Atualiza tudo que a checagem achou, UM POR VEZ e NA ORDEM DA LISTA.
   *
   * A ordem importa: quando uma atualização só destrava depois de outra (o caso
   * do hognus, SAIN esperando o BigBrain novo), a checagem já devolve a lista na
   * ordem de instalação. Clicando um por um, dava pra instalar o SAIN antes.
   *
   * Um que falha não para os outros: o erro fica na fila, com Detalhes, e o
   * aviso do fim diz quem faltou. Reescaneia uma vez só, no fim.
   */
  async function handleUpdateAll() {
    if (!forgeResult) return;
    const pendentes = forgeResult.updates.filter((u) => u.downloadLink && !atualizadosNoPainel.has(u.name));
    if (pendentes.length === 0) return;
    setAtualizandoTodos(true);
    const previousKeys = new Set(mods.map(selectionKey));
    const ok: string[] = [];
    const falhas: string[] = [];
    // Tudo entra na fila de uma vez, mas cada um só instala depois do anterior:
    // a lista já está na ordem das dependências (B antes de A quando A precisa do B novo).
    const ids = pendentes.map(() => novoJobId());
    const resultados = await Promise.all(
      pendentes.map((u, i) => instalarAtualizacao(u, { id: ids[i], after: i > 0 ? [ids[i - 1]] : [] }))
    );
    resultados.forEach((result, i) => {
      if (result.success) ok.push(pendentes[i].name);
      else if (!result.cancelled) falhas.push(pendentes[i].name);
    });
    setUpdatingModName(null);
    setAtualizandoTodos(false);
    if (ok.length > 0) {
      forgetForgeStatus(ok);
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
    pushToast(
      falhas.length === 0
        ? t("toast.updateAllDone", { done: ok.length, total: pendentes.length })
        : t("toast.updateAllPartial", { done: ok.length, total: pendentes.length, failed: falhas.join(", ") }),
      falhas.length === 0
    );
  }

  /**
   * Formata bytes pra leitura humana. O tamanho importa aqui porque tem
   * dependência de 5 GB no catálogo: saber ANTES de clicar muda a decisão.
   */
  function formataTamanho(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  /**
   * Faz a instalação em si. Extraído do handleInstallFromForge porque agora ele
   * pode instalar mais de uma coisa: as dependências primeiro, o mod depois.
   * A ordem não é estética — um mod que sobe antes da lib de que depende pode
   * falhar no primeiro carregamento do servidor.
   */
  async function instalarDoCatalogo(
    nome: string,
    link: string,
    registro: { id?: number; name: string; author?: string; version?: string; guid?: string },
    opts?: { id?: string; after?: string[]; principal?: { nome: string; jobId: string } }
  ): Promise<boolean> {
    const queueId = opts?.id ?? novoJobId();
    if (opts?.principal) principalDoJob.current.set(queueId, opts.principal);
    const result = await installArchiveWithConfirmFlow(
      window.modManagerAPI.installForgeMod(queueId, link, nome, registro, opts?.after ?? [])
    );
    registrarFimDownload(queueId, nome, result);
    if (!result.cancelled) pushToast(tMsg(result.message), result.success, result.message);
    return result.success;
  }

  /** Executa a instalação do mod escolhido, opcionalmente com as dependências. */
  async function executarInstalacao(
    mod: ForgeCatalogMod,
    version: { id: number; version: string; link: string },
    deps: ModDependencyInfo[]
  ) {
    marcarInstalando(mod.id, true);
    const previousKeys = new Set(mods.map(selectionKey));

    // Guarda o que realmente entrou, pra marcar as linhas depois. Sem isto, a
    // dependência baixada junto continuava com o botão "Instalar" até o usuário
    // buscar de novo — o mod estava no disco e a tela dizia que não.
    const depsInstaladas = new Map<number, string | undefined>();
    // Dependências e mod entram juntos na fila (dá pra ver e cancelar qualquer
    // um), cada dependência instala depois da anterior e o mod por último.
    const comLink = deps.filter((d) => d.downloadLink);
    const idsDeps = comLink.map(() => novoJobId());
    const idMod = novoJobId();
    if (comLink.length > 0) pushToast(t("deps.installingDependency", { name: comLink.map((d) => d.name).join(", ") }), true);
    const promessasDeps = comLink.map((d, i) =>
      instalarDoCatalogo(
        d.name,
        d.downloadLink!,
        {
          id: d.id || undefined,
          name: d.name,
          version: d.version,
          guid: d.guid
        },
        { id: idsDeps[i], after: i > 0 ? [idsDeps[i - 1]] : [], principal: { nome: mod.name, jobId: idMod } }
      ).then((okDep) => {
        if (okDep && d.id) depsInstaladas.set(d.id, d.version);
      })
    );
    const promessaMod = instalarDoCatalogo(
      mod.name,
      version.link,
      {
        id: mod.id,
        name: mod.name,
        author: mod.author,
        version: version.version,
        guid: mod.guid
      },
      { id: idMod, after: idsDeps }
    );
    await Promise.all(promessasDeps);
    const ok = await promessaMod;
    marcarInstalando(mod.id, false);

    // As dependências são marcadas mesmo que o mod principal falhe: elas
    // entraram, e a tela tem que dizer a verdade sobre cada uma.
    if (ok || depsInstaladas.size > 0) {
      setBrowseResults((anteriores) =>
        anteriores.map((m) => {
          if (ok && m.id === mod.id) return { ...m, installed: true, installedVersion: version.version };
          if (depsInstaladas.has(m.id)) {
            return { ...m, installed: true, installedVersion: depsInstaladas.get(m.id) };
          }
          return m;
        })
      );
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);

      // Recalcula os selos da página. Sem isto o que acabou de ser instalado
      // continua marcado como pendente até o usuário buscar de novo — e a
      // dependência recém-baixada some do disco mas não da tela.
      const chaves = Object.keys(depsPorChave);
      if (chaves.length > 0) {
        void window.modManagerAPI
          .fetchModDependenciesBatch(chaves)
          .then((mapa) => setDepsPorChave((anterior) => ({ ...anterior, ...mapa })))
          .catch(() => {
            /* selo velho e melhor que travar a tela */
          });
      }
    }
  }

  async function handleInstallFromForge(mod: ForgeCatalogMod) {
    // Sem escolha explícita, cai na versão compatível apontada pela busca — e só
    // depois na mais nova. O contrário instalava a versão incompatível pra quem
    // tinha justamente pedido só as compatíveis.
    const versionId = selectedVersionByModId.get(mod.id) ?? mod.compatibleVersionId ?? mod.versions[0]?.id;
    const version = mod.versions.find((v) => v.id === versionId) ?? mod.versions[0];
    if (!version) {
      pushToast(t("browse.noVersionPublished", { name: mod.name }), false);
      return;
    }
    // Versão feita pra outro SPT: confirma antes. Era o relato do BrownieMug:
    // o catálogo tem o "Amands' Sense" original (último pro SPT 3.7) e o
    // "Amands' Sense - Updated"; instalar o primeiro passava calado. E um mod
    // de servidor fora da faixa faz o SPT 4 não carregar mod de servidor nenhum.
    if (
      version.compatibility === "incompatible" &&
      !(await confirmar(
        t("browse.confirmIncompatible", {
          name: mod.name,
          version: version.version,
          declared: version.sptConstraint || "?",
          spt: sptVersionInput || "?"
        })
      ))
    ) {
      return;
    }
    marcarInstalando(mod.id, true);
    // Pergunta à fonte o que ESTA versão exige. Falha de rede devolve lista
    // vazia e a instalação segue: a checagem é auxílio, não pedágio.
    const deps = await window.modManagerAPI.fetchModDependencies(mod.id, version.version);
    marcarInstalando(mod.id, false);

    // Só interrompe se houver algo a fazer. Dependência já satisfeita aparece no
    // diálogo, mas sozinha não justifica abrir diálogo nenhum.
    const acionaveis = deps.filter((d) => d.status !== "installed");
    if (acionaveis.length > 0) {
      setDepPrompt({ mod, version, deps });
      return;
    }

    await executarInstalacao(mod, version, []);
  }

  function startRename(mod: ModInfo) {
    setEditingKey(selectionKey(mod));
    setEditingValue(mod.name);
    setOpenMenuKey(null);
  }

  function cancelRename() {
    setEditingKey(null);
    setEditingValue("");
  }

  async function confirmRename(mod: ModInfo) {
    const trimmed = editingValue.trim();
    const newAlias = trimmed === mod.originalName ? "" : trimmed;
    const result = await window.modManagerAPI.renameMod(mod.id, newAlias);
    pushToast(tMsg(result.message), result.success, result.message);
    setEditingKey(null);
    if (result.success) {
      const displayName = newAlias || mod.originalName;
      setMods((prev) => prev.map((m) => (m.id === mod.id && m.type === mod.type ? { ...m, name: displayName } : m)));
    }
  }

  function toggleSelect(mod: ModInfo) {
    const key = selectionKey(mod);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedKeys(new Set(filteredMods.map(selectionKey)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  const selectedMods = useMemo(() => mods.filter((m) => selectedKeys.has(selectionKey(m))), [mods, selectedKeys]);

  async function runBulk(action: "enable" | "disable" | "remove") {
    if (selectedMods.length === 0) return;
    if (action === "remove") {
      const confirmed = await confirmar(t("toast.confirmRemoveBulk", { count: selectedMods.length }));
      if (!confirmed) return;
    }
    setMutating(true);
    const succeededKeys = new Set<string>();
    for (const mod of selectedMods) {
      if (action === "enable" && mod.enabled) continue;
      if (action === "disable" && !mod.enabled) continue;
      const result = action === "remove" ? await window.modManagerAPI.uninstallMod(mod) : await window.modManagerAPI.toggleMod(mod);
      if (result.success) succeededKeys.add(selectionKey(mod));
    }

    if (action === "remove") {
      // Mesma limpeza do handleUninstall: sem isto a etiqueta de atualização
      // sobrevive ao mod e volta até depois de fechar o app.
      forgetForgeStatus(selectedMods.filter((m) => succeededKeys.has(selectionKey(m))).map((m) => m.name));
      setMods((prev) => prev.filter((m) => !succeededKeys.has(selectionKey(m))));
    } else {
      setMods((prev) => prev.map((m) => (succeededKeys.has(selectionKey(m)) ? { ...m, enabled: action === "enable" } : m)));
    }

    pushToast(t("toast.bulkProcessed", { done: succeededKeys.size, total: selectedMods.length }), true);
    // Em lote, um item de pacote arrasta as partes irmãs junto — a atualização local
    // acima não sabe disso, então re-escaneia pra lista bater com o disco.
    if (selectedMods.some((m) => m.packageId)) refreshMods();
    clearSelection();
    setMutating(false);
  }

  function selectRange(keys: string[]) {
    setSelectedKeys((prev) => new Set([...prev, ...keys]));
  }

  // Quantas partes cada pacote tem instaladas. Serve pra avisar na linha do mod que ele
  // faz parte de um conjunto — sem isso, ver a outra metade desabilitar junto parece bug.
  const listProps = {
    isExpanded: pacoteAberto,
    toggleExpanded: alternarPacote,
    categoryMenu:
      modoEdicao
        ? {
            options: custom.categories,
            currentOf: (nodeKey: string) => {
              const linha = linhaPorChave.get(nodeKey);
              return (linha && categoryOf(custom, linha)) || UNCATEGORIZED;
            },
            onMove: (nodeKey: string, catId: string) => moverParaCategoria([nodeKey], catId)
          }
        : undefined,
    onToggle: handleToggle,
    onUninstall: handleUninstall,
    onOpenFolder: handleOpenFolder,
    onOpenModPage: handleOpenModPage,
    onReinstall: handleReinstall,
    onLinkModPage: openLinkDialog,
    onSetVersion: informarVersao,
    onClearLink: handleClearLink,
    onRenameStart: startRename,
    onRenameCancel: cancelRename,
    onRenameConfirm: confirmRename,
    editingKey,
    editingValue,
    onEditingValueChange: setEditingValue,
    selectedKeys,
    onToggleSelect: toggleSelect,
    onRangeSelect: selectRange,
    openMenuKey,
    onSetOpenMenuKey: setOpenMenuKey,
    disabled: mutating,
    forgeStatusByName,
    t
  };


  const i18nChangelog = { lang, t, tMsg };
  return (
    <ChangelogI18n.Provider value={i18nChangelog}>
      <ToastStack
        toasts={toasts}
        detalhesLabel={t("error.details")}
        onDetalhes={(toast) => {
          setToasts((prev) => prev.filter((x) => x.id !== toast.id));
          void abrirErro(toast.text, toast.raw!);
        }}
      />

      {appUpdate?.updateAvailable && !updateDismissed && (
        <div className="update-banner">
          <span>
            {t("update.available", {
              latest: appUpdate.latestVersion ?? "",
              current: appUpdate.currentVersion
            })}
          </span>
          <div className="update-banner-actions">
            {appUpdate.downloadPageUrl && (
              <button
                className="primary"
                onClick={() => window.modManagerAPI.openReleasePage(appUpdate.downloadPageUrl!)}
              >
                {t("update.download")}
              </button>
            )}
            {appUpdate.releaseUrl && (
              <button onClick={() => window.modManagerAPI.openReleasePage(appUpdate.releaseUrl!)}>
                {t("update.viewChangelog")}
              </button>
            )}
            <button onClick={() => setUpdateDismissed(true)}>{t("update.dismiss")}</button>
          </div>
        </div>
      )}

      {(downloadQueue.length > 0 || filaBackend.length > 0) && (
        // Nas configurações a fila desce pra baixo do painel: ela só fica por cima
        // das janelas porque é no Navegar que mais se baixa.
        <div className={`download-queue-panel${configAberta ? " under-settings" : ""}`}>
          {lookupInProgress && (
            <div className="download-queue-item queue-summary-card">
              <div className="queue-item-name">
                {forgeProgress && forgeProgress.total > 0
                  ? t("restore.lookingUpCount", { done: forgeProgress.done, total: forgeProgress.total })
                  : t("restore.lookingUp")}
              </div>
              {forgeProgress && forgeProgress.total > 0 && (
                <>
                  <div className="queue-progress-track">
                    <div
                      className="queue-progress-fill"
                      style={{ width: `${Math.round((forgeProgress.done / forgeProgress.total) * 100)}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          {installProgress && (
            <div className="download-queue-item queue-summary-card">
              <div className="queue-item-name">
                {t("restore.installingProgress", { done: installProgress.done, total: installProgress.total })}
              </div>
              <div className="queue-progress-track">
                <div
                  className="queue-progress-fill"
                  style={{ width: `${Math.round((installProgress.done / installProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {filaBackend.length > 0 && (() => {
            const baixando = filaBackend.filter((j) => j.state === "downloading").length;
            const esperando = filaBackend.filter((j) => j.state === "queued" || j.state === "paused").length;
            const atual = filaBackend.find((j) => j.state === "downloading" && j.total > 0);
            return (
              <div className="download-queue-item queue-summary-card queue-panel-head">
                <span>
                  {t("queue.header", { downloading: baixando, waiting: esperando })}
                  {filaRecolhida && atual ? ` · ${Math.round((atual.received / atual.total) * 100)}%` : ""}
                </span>
                <div className="queue-head-actions">
                  {esperando > 0 && !filaRecolhida && (
                    <button className="queue-link" onClick={cancelarFila}>
                      {t("queue.cancelWaiting")}
                    </button>
                  )}
                  <button
                    className="queue-btn"
                    title={filaRecolhida ? t("queue.expand") : t("queue.collapse")}
                    aria-label={filaRecolhida ? t("queue.expand") : t("queue.collapse")}
                    aria-expanded={!filaRecolhida}
                    onClick={() => setFilaRecolhida((v) => !v)}
                  >
                    <IconeFila tipo={filaRecolhida ? "up" : "down"} />
                  </button>
                </div>
              </div>
            );
          })()}
          {!filaRecolhida && filaBackend.map((job, indice) => {
            const movivel = (j: DownloadQueueJob) => j.state === "queued" || j.state === "paused";
            const podeSubir = movivel(job) && filaBackend.slice(0, indice).some(movivel);
            const podeDescer = movivel(job) && filaBackend.slice(indice + 1).some(movivel);
            const pct = job.total > 0 ? Math.min(100, Math.round((job.received / job.total) * 100)) : null;
            const eta = job.state === "downloading" && job.speed > 0 && job.total > 0 ? (job.total - job.received) / job.speed : 0;
            return (
              <div key={job.id} className={`download-queue-item queue-status-${job.state}`}>
                <div className="queue-item-head">
                  <div className="queue-item-name" title={job.name}>{job.name}</div>
                  <div className="queue-actions">
                    {movivel(job) && (
                      <>
                        <button className="queue-btn" disabled={!podeSubir} title={t("queue.moveUp")} aria-label={t("queue.moveUp")} onClick={() => controlarDownload("up", job)}>
                          <IconeFila tipo="up" />
                        </button>
                        <button className="queue-btn" disabled={!podeDescer} title={t("queue.moveDown")} aria-label={t("queue.moveDown")} onClick={() => controlarDownload("down", job)}>
                          <IconeFila tipo="down" />
                        </button>
                      </>
                    )}
                    {job.state === "downloading" && !job.fromCache && (
                      <button className="queue-btn" title={t("queue.pause")} aria-label={t("queue.pause")} onClick={() => controlarDownload("pause", job)}>
                        <IconeFila tipo="pause" />
                      </button>
                    )}
                    {job.state === "paused" && (
                      <button className="queue-btn" title={t("queue.resume")} aria-label={t("queue.resume")} onClick={() => controlarDownload("resume", job)}>
                        <IconeFila tipo="play" />
                      </button>
                    )}
                    {job.state !== "installing" && (
                      <button
                        className="queue-btn danger"
                        title={job.state === "queued" ? t("queue.remove") : t("queue.cancel")}
                        aria-label={job.state === "queued" ? t("queue.remove") : t("queue.cancel")}
                        onClick={() => cancelarDownload(job)}
                      >
                        <IconeFila tipo="x" />
                      </button>
                    )}
                  </div>
                </div>
                {(job.state === "downloading" || job.state === "paused") && !job.fromCache && (
                  <div className="queue-item-body">
                    <div className="queue-progress-track">
                      <div className="queue-progress-fill" style={{ width: `${pct ?? 0}%` }} />
                    </div>
                    <div className="queue-item-meta">
                      <span>{job.state === "paused" ? t("queue.pausedAt", { pct: pct ?? 0 }) : pct !== null ? `${pct}%` : ""}</span>
                      <span>
                        {formatBytes(job.received)}
                        {job.total > 0 ? ` / ${formatBytes(job.total)}` : ""}
                      </span>
                      {job.state === "downloading" && job.speed > 0 && (
                        <span>
                          {formatBytes(job.speed)}/s{eta > 0 ? ` · ${formatEta(eta)}` : ""}
                        </span>
                      )}
                    </div>
                    {job.restarted && <div className="queue-item-note">{t("queue.restarted")}</div>}
                  </div>
                )}
                {job.state === "queued" && <div className="queue-item-body queue-item-status">{t("queue.waiting")}</div>}
                {job.state === "waiting" && <div className="queue-item-body queue-item-status">{t("queue.waitingInstall")}</div>}
                {(job.state === "installing" || (job.state === "downloading" && job.fromCache)) && (
                  <div className="queue-item-body queue-item-status">
                    {job.fromCache ? t("queue.installingFromCache") : t("queue.installing")}
                  </div>
                )}
              </div>
            );
          })}
          {downloadQueue.map((item) => {
            return (
              <div key={item.id} className={`download-queue-item queue-status-${item.status}`}>
                <div className="queue-item-name" title={item.name}>{item.name}</div>
                {item.status === "queued" && <div className="queue-item-status">{t("queue.waiting")}</div>}
                {/* Arquivo local (arrastado ou escolhido): não tem download, só instalação. */}
                {item.status === "active" && <div className="queue-item-status">{t("queue.installing")}</div>}
                {item.status === "done" && (
                  <div className="queue-item-status queue-status-done-text">
                    ✔ {t("queue.done")}
                    {item.fromCache && <span className="queue-from-cache"> · {t("queue.fromCache")}</span>}
                  </div>
                )}
                {item.status === "cancelled" && <div className="queue-item-status">{t("queue.cancelled")}</div>}
                {item.status === "error" && (
                  <div className="queue-item-status queue-status-error-text">
                    ✕ {item.message ?? t("queue.failed")}
                    {relatavel(item.raw) && (
                      <button
                        className="toast-details"
                        onClick={() => abrirErro(item.message ?? item.raw!, item.raw!)}
                      >
                        {t("error.details")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!sptPath ? (
        <div className="empty-state">
          {/* Sem instância ainda: a engrenagem já dá acesso a idioma e tema. */}
          <button className="gear-button empty-state-gear" onClick={abrirConfig} title={t("settings.title")} aria-label={t("settings.title")}>
            ⚙
          </button>
          <h1>SPT Mod Manager</h1>
          <p>{t("empty.selectFolder")}</p>
          <button onClick={handleSelectFolder}>{t("empty.selectFolderButton")}</button>
          <button onClick={handleOpenModHub}>{t("empty.downloadModsButton")}</button>
        </div>
      ) : (
        <div
          className="app"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDraggingFile && (
            <div className="drop-overlay">
              <div className="drop-overlay-box">{t("dropOverlay.text")}</div>
            </div>
          )}
          <header>
            <div>
              <h1>SPT Mod Manager</h1>
            </div>
            {/* Instância, idioma e versões foram pra engrenagem: são coisas que se
                configura uma vez, e disputavam espaço com o que se usa todo dia. */}
            <div className="header-actions">
              <button onClick={handleOpenBrowse} className="primary" title={t("header.browseForgeTitle")}>
                {t("header.browseForge")}
              </button>
              <button onClick={handleOpenModHub} title={t("header.openHubTitle")}>{t("header.openHub")}</button>
              <button onClick={handleInstall} disabled={loading} className="primary" title={t("header.installButtonTitle")}>
                {loading ? t("header.installing") : t("header.installButton")}
              </button>
              <span className="header-separator" />
              <button
                onClick={() => void handleLaunch("server")}
                disabled={!launchTargets.server}
                title={launchTargets.server ? t("header.startServerTitle") : t("header.exeMissing", { exe: "SPT.Server.exe" })}
              >
                ▶ {t("header.startServer")}
              </button>
              <button
                onClick={() => void handleLaunch("launcher")}
                disabled={!launchTargets.launcher}
                title={launchTargets.launcher ? t("header.startLauncherTitle") : t("header.exeMissing", { exe: "SPT.Launcher.exe" })}
              >
                ▶ {t("header.startLauncher")}
              </button>
              <button
                className="gear-button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                title={t("header.refreshTitle")}
                aria-label={t("header.refresh")}
              >
                ⟳
              </button>
              <button className="gear-button" onClick={abrirConfig} title={t("settings.title")} aria-label={t("settings.title")}>
                ⚙
              </button>
            </div>
          </header>

          <div className="summary-bar">
            <span className="summary-item">
              <strong>{summary.total}</strong> {t("summary.total")}
            </span>
            <span className="summary-item">Server: <strong>{summary.server}</strong></span>
            <span className="summary-item">Client: <strong>{summary.client}</strong></span>
            <span className="summary-item summary-active">{t("summary.active")} <strong>{summary.active}</strong></span>
            <span className="summary-item summary-disabled">{t("summary.disabled")} <strong>{summary.disabled}</strong></span>
          </div>

          {(() => {
            // O servidor do SPT 4 não carrega NENHUM mod de servidor se um único
            // deles declarar uma faixa de SPT que não aceita a versão instalada
            // (ModValidator: erro e "no mods loaded"). Sem este aviso a pessoa só
            // descobre no log do servidor, sem saber qual mod é o culpado.
            const travam = mods.filter((m) => m.type === "server" && m.enabled && m.sptCompatibility === "incompatible");
            if (travam.length === 0) return null;
            const nomes = travam.slice(0, 3).map((m) => `${m.name} (${m.sptVersion ?? "?"})`).join(", ");
            return (
              <div className="spt-block-warning" role="alert">
                <strong>{t("warning.serverModsBlockedTitle")}</strong>{" "}
                {t("warning.serverModsBlocked", {
                  count: travam.length,
                  names: nomes + (travam.length > 3 ? t("restore.andMore", { count: travam.length - 3 }) : ""),
                  version: sptVersionInput || "?"
                })}
              </div>
            );
          })()}

          {perfis && perfis.profiles.length > 0 && (
            <div className="profile-bar">
              <span className="profile-label" title={t("profiles.labelTitle")}>
                {t("profiles.label")}
              </span>
              <select
                className="profile-select"
                value={perfis.active}
                disabled={mutating}
                onChange={(e) => void trocarPerfil(e.target.value)}
                title={t("profiles.selectTitle")}
              >
                {perfis.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {/* O ativo é o estado atual: conta pela lista na tela, que já está
                        carregada, em vez de pedir outro scan do disco a cada mudança. */}
                    {p.name} (
                    {p.id === perfis.active
                      ? t("profiles.counts", { enabled: summary.active, total: summary.total })
                      : t("profiles.counts", { enabled: p.enabledCount, total: p.modCount })}
                    )
                  </option>
                ))}
              </select>
              <button onClick={() => void criarPerfil()} disabled={mutating} title={t("profiles.newButtonTitle")}>
                + {t("profiles.newButton")}
              </button>
              <button onClick={() => void renomearPerfil()} disabled={mutating}>
                {t("profiles.renameButton")}
              </button>
              {perfis.profiles.length > 1 && (
                <select
                  className="profile-delete"
                  value=""
                  disabled={mutating}
                  onChange={(e) => {
                    const id = e.target.value;
                    e.target.value = "";
                    if (id) void apagarPerfil(id);
                  }}
                  title={t("profiles.deleteTitle")}
                >
                  <option value="">{t("profiles.deleteButton")}</option>
                  {perfis.profiles
                    .filter((p) => p.id !== perfis.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              )}
              <span className="filter-separator" />
              <button onClick={handleExportList} title={t("profiles.exportTitle")}>{t("profiles.export")}</button>
              <button onClick={() => void handleImportList()} title={t("profiles.importTitle")}>{t("profiles.import")}</button>
            </div>
          )}

          <input
            className="search-bar"
            type="text"
            placeholder={t("filters.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="filter-bar">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} title={t("filters.statusFilterTitle")}>
              <option value="all">{t("filters.statusAll")}</option>
              <option value="enabled">{t("filters.statusEnabled")}</option>
              <option value="disabled">{t("filters.statusDisabled")}</option>
            </select>
            <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} title={t("filters.originFilterTitle")}>
              <option value="all">{t("filters.originAll")}</option>
              <option value="manual">{t("filters.originManual")}</option>
              <option value="manager">{t("filters.originManager")}</option>
            </select>
            <select
              value={fikaFilter}
              onChange={(e) => setFikaFilter(e.target.value as FikaFilter)}
              title={t("filters.fikaFilterTitle", { count: semIdNoCatalogo })}
            >
              <option value="all">{t("filters.fikaAll")}</option>
              <option value="compatible">{t("filters.fikaCompatible")}</option>
              <option value="incompatible">{t("filters.fikaIncompatible")}</option>
            </select>
            {fikaFilter !== "all" && fikaLoading && <span className="filter-note">{t("filters.fikaLoading")}</span>}

            <span className="filter-separator" />



            <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} title={t("filters.sortFieldTitle")}>
              <option value="name">{t("filters.sortByName")}</option>
              <option value="status">{t("filters.sortByStatus")}</option>
              <option value="origin">{t("filters.sortByOrigin")}</option>
              <option value="installedAt">{t("filters.sortByInstalledAt")}</option>
              <option value="forge">{t("filters.sortByForge")}</option>
            </select>
            <button onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))} title={t("filters.sortDirectionTitle")}>
              {t(
                sortField === "installedAt"
                  ? sortDirection === "asc"
                    ? "filters.sortOldestFirst"
                    : "filters.sortNewestFirst"
                  : sortField === "name"
                    ? sortDirection === "asc"
                      ? "filters.sortAZ"
                      : "filters.sortZA"
                    : sortDirection === "asc"
                      ? "filters.sortAsc"
                      : "filters.sortDesc"
              )}
            </button>

            <span className="filter-separator" />

            <button onClick={selectAllVisible} title={t("filters.selectAllVisibleTitle")}>{t("filters.selectAllVisible")}</button>
            {selectedKeys.size > 0 && <button onClick={clearSelection}>{t("filters.clearSelection")}</button>}

            <span className="filter-separator" />

            <button onClick={handleDetectConflicts} disabled={checkingConflicts} title={t("filters.checkConflictsTitle")}>
              {checkingConflicts ? t("filters.checkingConflicts") : t("filters.checkConflicts")}
            </button>
            <span className="filter-separator"></span>
            <select
              className="version-input"
              value={sptVersionInput}
              onChange={(e) => {
                setSptVersionInput(e.target.value);
                window.modManagerAPI.setSptVersionOverride(e.target.value);
              }}
              title={t("filters.sptVersionTitle")}
            >
              <option value="">{t("filters.sptVersionPlaceholder")}</option>
              {forgeSptVersions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} ({v.modCount} mods)
                </option>
              ))}
              {sptVersionInput && !forgeSptVersions.some((v) => v.version === sptVersionInput) && (
                <option value={sptVersionInput}>{sptVersionInput} {t("filters.sptVersionNotListed")}</option>
              )}
            </select>
            <button
              onClick={handleCheckForgeUpdates}
              disabled={checkingForgeUpdates}
              title={t("filters.forgeCheckTitle")}
            >
              {checkingForgeUpdates
                ? forgeProgress && forgeProgress.total > 0
                  ? t("filters.forgeCheckingProgress", { done: forgeProgress.done, total: forgeProgress.total })
                  : t("filters.forgeChecking")
                : t("filters.forgeCheckButton")}
            </button>
          </div>

          {forgeCheckedAt && (
            <p className="sort-hint">
              {t("hint.forgeLastChecked", { date: new Date(forgeCheckedAt).toLocaleString(lang) })}
            </p>
          )}


          {compareResult && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("profiles.reportTitle")}</strong>
                <button onClick={() => setCompareResult(null)}>{t("common.close")}</button>
              </div>
              {compareResult.missing.length === 0 && compareResult.extra.length === 0 ? (
                <p>{t("profiles.reportNothing")}</p>
              ) : (
                <>
                  {compareResult.missing.length > 0 && (
                    <p>
                      <strong>{t("profiles.reportMissing", { count: compareResult.missing.length })}</strong> {compareResult.missing.join(", ")}
                    </p>
                  )}
                  {compareResult.extra.length > 0 && (
                    <p>
                      <strong>{t("profiles.reportDisabled", { count: compareResult.extra.length })}</strong> {compareResult.extra.join(", ")}
                    </p>
                  )}
                </>
              )}
              <p className="compare-note">{t("profiles.reportNote")}</p>
            </div>
          )}

          {conflictReport && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("conflicts.title")}</strong>
                <button onClick={() => setConflictReport(null)}>{t("common.close")}</button>
              </div>
              {conflictReport.clientFileConflicts.length === 0 &&
              conflictReport.duplicateServerNames.length === 0 &&
              (conflictReport.duplicateClientMods?.length ?? 0) === 0 ? (
                <p>{t("toast.noConflictsFound")}</p>
              ) : (
                <>
                  {conflictReport.clientFileConflicts.map((c) => (
                    <p key={`dll-${c.fileName}`}>
                      <strong>DLL "{c.fileName}"</strong> {t("conflicts.appearsIn")} {c.mods.join(", ")}
                    </p>
                  ))}
                  {(conflictReport.duplicateClientMods ?? []).map((d) => (
                    <p key={`client-dup-${d.declaredName}`}>
                      <strong>{t("conflicts.sameModTwice")}</strong> {d.mods.join(", ")}
                    </p>
                  ))}
                  {conflictReport.duplicateServerNames.map((d) => (
                    <p key={`name-${d.declaredName}`}>
                      <strong>{t("conflicts.nameLabel")} "{d.declaredName}"</strong> {t("conflicts.declaredInMultiple")} {d.mods.join(", ")}
                    </p>
                  ))}
                </>
              )}
              <p className="compare-note">{t("conflicts.note")}</p>
            </div>
          )}

          {forgeError && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("forge.checkTitle")}</strong>
                <button onClick={() => setForgeError(null)}>{t("common.close")}</button>
              </div>
              <p>{forgeError}</p>
            </div>
          )}

          {forgeResult && (() => {
            // Repaginado na 0.8.0: era um parágrafo por mod, com botão laranja em
            // toda linha e as versões onde o texto acabava. Agora é uma lista em
            // colunas (nome | versões | ações), um só botão de destaque
            // ("Atualizar todos"), e o que não pede ação fica recolhido.
            const pendentes = forgeResult.updates.filter((u) => u.downloadLink && !atualizadosNoPainel.has(u.name));
            const nada =
              forgeResult.updates.length === 0 &&
              forgeResult.blocked.length === 0 &&
              forgeResult.incompatible.length === 0 &&
              forgeResult.infoOnly.length === 0;
            return (
              <section className="upd-panel" aria-label={t("forge.checkTitle")}>
                <div className="upd-head">
                  <h2 className="upd-title">{t("forge.checkTitle")}</h2>
                  <span className="upd-spt">SPT {forgeResult.sptVersionUsed}</span>
                  <span className="upd-head-spacer" />
                  {pendentes.length > 1 && (
                    <button className="primary" disabled={atualizandoTodos || updatingModName !== null} onClick={handleUpdateAll}>
                      {atualizandoTodos ? t("forge.updating") : t("forge.updateAllCount", { count: pendentes.length })}
                    </button>
                  )}
                  <button className="upd-close" onClick={() => setForgeResult(null)} aria-label={t("common.close")} title={t("common.close")}>
                    ✕
                  </button>
                </div>

                {nada && <p className="upd-empty">{t("forge.allUpToDateDetailed")}</p>}

                {forgeResult.updates.length > 0 && (
                  <div className="upd-section">
                    <div className="upd-section-head">
                      {t("forge.sectionUpdates")} <span className="upd-count">{forgeResult.updates.length}</span>
                    </div>
                    <ul className="upd-list">
                      {forgeResult.updates.map((u) => {
                        const feito = atualizadosNoPainel.has(u.name);
                        return (
                          <li key={`update-${u.name}`} className={`upd-row ${feito ? "done" : ""}`}>
                            <div className="upd-name">
                              <NomeComPagina nome={u.name} modId={u.modId} titulo={t("forge.openVersions")} />
                              {/* Sai do bloqueio depois que os de cima atualizarem: a lista
                                  já está na ordem de instalação. */}
                              {u.reason === "unblocked_after_update" && <span className="upd-tag">{t("forge.afterOthers")}</span>}
                            </div>
                            <div className="upd-versions">
                              <span className="upd-from">{u.currentVersion}</span>
                              <span className="upd-arrow" aria-hidden="true">→</span>
                              <span className="upd-to">{u.recommendedVersion}</span>
                            </div>
                            <div className="upd-actions">
                              {u.modId !== undefined && (
                                <ChangelogButton modId={u.modId} nome={u.name} de={u.currentVersion} para={u.recommendedVersion} />
                              )}
                              {feito ? (
                                <span className="upd-done">✓ {t("forge.updatedDone")}</span>
                              ) : (
                                u.downloadLink && (
                                  <button
                                    className="upd-button"
                                    // Durante o "Atualizar todos" os botões individuais ficam
                                    // travados: dois downloads do mesmo mod brigariam pela pasta.
                                    disabled={updatingModName === u.name || atualizandoTodos}
                                    onClick={() => handleInstallUpdate(u)}
                                  >
                                    {updatingModName === u.name ? t("forge.updating") : t("forge.updateNow")}
                                  </button>
                                )
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {forgeResult.blocked.length > 0 && (
                  // Recolhido por padrão (pedido do Crywolf642): com a checagem em
                  // cadeia sobram poucos casos de verdade. Cada um diz quem trava e
                  // dá pra forçar (pedido do Vorax).
                  <details className="upd-section">
                    <summary className="upd-section-head">
                      {t("forge.sectionBlocked")} <span className="upd-count">{forgeResult.blocked.length}</span>
                      <span className="upd-section-hint">{t("forge.sectionBlockedHint")}</span>
                    </summary>
                    <ul className="upd-list">
                      {forgeResult.blocked.map((b) => {
                        const quem = quemBloqueia(b);
                        const feito = atualizadosNoPainel.has(b.name);
                        return (
                          <li key={`blocked-${b.name}`} className={`upd-row ${feito ? "done" : ""}`}>
                            <div className="upd-name">
                              <NomeComPagina nome={b.name} modId={b.modId} titulo={t("forge.openVersions")} />
                              {quem && <span className="upd-sub">{t("forge.blockedBy", { who: quem })}</span>}
                            </div>
                            <div className="upd-versions">
                              <span className="upd-from">{b.currentVersion}</span>
                              {b.recommendedVersion && (
                                <>
                                  <span className="upd-arrow" aria-hidden="true">→</span>
                                  <span className="upd-to blocked">{b.recommendedVersion}</span>
                                </>
                              )}
                            </div>
                            <div className="upd-actions">
                              {feito ? (
                                <span className="upd-done">✓ {t("forge.updatedDone")}</span>
                              ) : (
                                b.modId !== undefined &&
                                b.recommendedVersion && (
                                  <button
                                    className="upd-button ghost"
                                    disabled={updatingModName !== null || atualizandoTodos}
                                    onClick={() => void handleForceUpdate(b)}
                                    title={t("forge.forceUpdateTitle")}
                                  >
                                    {updatingModName === b.name ? t("forge.updating") : t("forge.forceUpdate")}
                                  </button>
                                )
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}

                {forgeResult.incompatible.length > 0 && (
                  <details className="upd-section">
                    <summary className="upd-section-head">
                      {t("forge.sectionIncompatible", { version: forgeResult.sptVersionUsed })}{" "}
                      <span className="upd-count">{forgeResult.incompatible.length}</span>
                    </summary>
                    <ul className="upd-list">
                      {forgeResult.incompatible.map((i) => {
                        const instalado = mods.find((m) => m.name === i.name);
                        const servidor = instalado?.type === "server";
                        return (
                        <li key={`incompatible-${i.name}`} className="upd-row">
                          <div className="upd-name">
                            <NomeComPagina nome={i.name} modId={i.modId} titulo={t("forge.openVersions")} />
                            {i.declaredSpt && (
                              <span className="upd-sub">
                                {t("forge.declaresSpt", { declared: i.declaredSpt })}
                                {/* Mesmo 4.1, só outro patch: num mod de client costuma
                                    funcionar (o servidor nem confere). Num de servidor, não:
                                    o servidor recusa e leva os outros mods junto. */}
                                {i.nearMiss && !servidor && <> · {t("forge.nearMissClient")}</>}
                                {servidor && instalado?.sptCompatibility === "incompatible" && (
                                  <span className="upd-danger"> · {t("forge.serverWillRefuse")}</span>
                                )}
                              </span>
                            )}
                          </div>
                          <div className="upd-versions">
                            <span className="upd-from">{i.currentVersion}</span>
                          </div>
                          <div className="upd-actions" />
                        </li>
                        );
                      })}
                    </ul>
                  </details>
                )}

                {forgeResult.infoOnly.length > 0 && (
                  <details className="upd-section">
                    <summary className="upd-section-head">
                      {t("forge.sectionInfoOnly")} <span className="upd-count">{forgeResult.infoOnly.length}</span>
                      <span className="upd-section-hint">{t("forge.sectionInfoOnlyHint")}</span>
                    </summary>
                    <ul className="upd-list">
                      {forgeResult.infoOnly.map((info) => (
                        <li key={`info-${info.name}`} className="upd-row">
                          <div className="upd-name">{info.name}</div>
                          <div className="upd-versions">
                            <span className="upd-from">?</span>
                            <span className="upd-arrow" aria-hidden="true">→</span>
                            <span className="upd-to">{info.recommendedVersion}</span>
                          </div>
                          <div className="upd-actions" />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {forgeResult.unmatched.length > 0 && (
                  <details className="upd-section">
                    <summary className="upd-section-head">
                      {t("forge.sectionUnmatched")} <span className="upd-count">{forgeResult.unmatched.length}</span>
                      <span className="upd-section-hint">{t("forge.sectionUnmatchedHint")}</span>
                    </summary>
                    <ul className="upd-names">
                      {forgeResult.unmatched.map((nome) => (
                        <li key={`unmatched-${nome}`}>{nome}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {(forgeResult.skippedByBudget?.length ?? 0) > 0 && (
                  <p className="upd-note">{t("forge.skippedByBudget", { count: forgeResult.skippedByBudget!.length })}</p>
                )}
              </section>
            );
          })()}

          {selectedKeys.size > 0 && (
            <div className="bulk-bar">
              <span>{t("bulk.selectedCount", { count: selectedKeys.size })}</span>
              <div className="bulk-actions">
                <button onClick={() => runBulk("enable")} disabled={mutating}>{t("bulk.enable")}</button>
                <button onClick={() => runBulk("disable")} disabled={mutating}>{t("bulk.disable")}</button>
                <button onClick={() => runBulk("remove")} className="danger" disabled={mutating}>{t("bulk.remove")}</button>
                {modoEdicao && (
                  <select
                    className="bulk-move"
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      moverParaCategoria(chavesDeLinhaSelecionadas(), e.target.value);
                      clearSelection();
                    }}
                    aria-label={t("categories.moveTo")}
                  >
                    <option value="">{t("categories.moveTo")}...</option>
                    {custom.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value={UNCATEGORIZED}>{t("categories.uncategorized")}</option>
                  </select>
                )}
                <button onClick={clearSelection}>{t("bulk.cancelSelection")}</button>
              </div>
            </div>
          )}

          {filtersActive && filteredMods.length === 0 && mods.length > 0 && (
            <div className="no-results">
              {t("noResults.text")}
              <button onClick={clearFilters}>{t("noResults.clearFilters")}</button>
            </div>
          )}

          {/* Cabeçalho da lista: o que muda a LISTA (tipo, agrupamento, abrir e
              fechar, nova categoria) fica colado nela, e não perdido no meio dos
              filtros e botões de exportar. */}
          <div className="list-header">
            <div className="type-filter-bar">
              {typeFilterOptions.map((option) => (
                <button
                  key={option}
                  className={`type-filter-chip ${typeFilter === option ? "active" : ""}`}
                  onClick={() => setTypeFilter(option)}
                >
                  {t(`typeFilter.${option}`)} {typeCounts[option]}
                </button>
              ))}
            </div>
            <div className="list-header-actions">
              {modoEdicao && (
                <button className="primary" onClick={criarCategoria}>
                  + {t("categories.new")}
                </button>
              )}
              {groupMode === "custom" && (
                <button
                  className={editandoCategorias ? "edit-toggle on" : "edit-toggle"}
                  onClick={() => {
                    setEditandoCategorias((v) => !v);
                    setEditandoCategoria(null);
                  }}
                  aria-pressed={editandoCategorias}
                >
                  {editandoCategorias ? "✓ " + t("categories.doneEditing") : "✎ " + t("categories.edit")}
                </button>
              )}
              <button onClick={alternarTodas} title={todasRecolhidas ? t("categories.expandAll") : t("categories.collapseAll")}>
                {todasRecolhidas ? "⊞ " + t("categories.expandAll") : "⊟ " + t("categories.collapseAll")}
              </button>
              <label className="group-by">
                <span>{t("categories.groupBy")}</span>
                <select value={groupMode} onChange={(e) => mudarAgrupamento(e.target.value as GroupMode)}>
                  <option value="none">{t("categories.groupNone")}</option>
                  <option value="source">{t("categories.groupSource")}</option>
                  <option value="custom">{t("categories.groupCustom")}</option>
                </select>
              </label>
            </div>
          </div>

          {groupMode === "none" ? (
            <ModList nodes={modTree} {...listProps} />
          ) : (
            <>
              {buscandoCategorias && <p className="category-loading">{t("categories.loading")}</p>}
              {(() => {
                let deslocamento = 0;
                return grupos
                  // Com busca ativa, categoria vazia só atrapalha a leitura.
                  .filter((g) => g.nodes.length > 0 || (modoEdicao && !searchQuery.trim()))
                  .map((g) => {
                    const recolhida = recolhidas.has(chaveRecolhida(g.id));
                    const inicio = deslocamento;
                    deslocamento += g.nodes.length;
                    const nome = g.id === UNCATEGORIZED ? t("categories.uncategorized") : g.name;
                    const editavel = modoEdicao && g.id !== UNCATEGORIZED;
                    const editando = editandoCategoria?.id === g.id;
                    return (
                      <section
                        key={g.id}
                        className={`category-group ${alvoDoArrasto === g.id ? "drop-target" : ""}`}
                        onDragOver={(e) => {
                          if (!modoEdicao || !e.dataTransfer.types.includes(ARRASTO_MOD)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "move";
                          if (alvoDoArrasto !== g.id) setAlvoDoArrasto(g.id);
                        }}
                        onDragLeave={(e) => {
                          // Só limpa quando sai da seção de verdade, não ao passar
                          // de uma linha pra outra dentro dela.
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAlvoDoArrasto(null);
                        }}
                        onDrop={(e) => soltarNaCategoria(e, g.id)}
                      >
                        <div className="category-header">
                          <button
                            className="category-toggle"
                            onClick={() => alternarCategoria(g.id)}
                            aria-expanded={!recolhida}
                          >
                            <span className={`category-chevron ${recolhida ? "" : "open"}`}>▶</span>
                            {!editando && <span className="category-name">{nome}</span>}
                            {!editando && <span className="category-count">{t("categories.count", { count: g.nodes.length })}</span>}
                          </button>
                          {editando && (
                            <input
                              className="rename-input category-rename"
                              autoFocus
                              value={editandoCategoria!.valor}
                              onChange={(e) => setEditandoCategoria({ id: g.id, valor: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmarRenomeCategoria();
                                if (e.key === "Escape") setEditandoCategoria(null);
                              }}
                              onBlur={confirmarRenomeCategoria}
                            />
                          )}
                          {editavel && !editando && (
                            <div className="category-actions">
                              <button onClick={() => setEditandoCategoria({ id: g.id, valor: g.name })} title={t("categories.rename")}>
                                ✎
                              </button>
                              <button onClick={() => salvarCustom(moveCategory(custom, g.id, -1))} title={t("categories.moveUp")}>
                                ↑
                              </button>
                              <button onClick={() => salvarCustom(moveCategory(custom, g.id, 1))} title={t("categories.moveDown")}>
                                ↓
                              </button>
                              <button className="danger" onClick={() => apagarCategoria(g.id, g.name)} title={t("categories.delete")}>
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                        {!recolhida && (
                          <div className="category-body">
                            {g.nodes.length > 0 ? (
                              <ModList nodes={g.nodes} numberOffset={inicio} {...listProps} />
                            ) : (
                              <p className="category-empty">{t("categories.empty")}</p>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  });
              })()}
            </>
          )}
        </div>
      )}

      {browseOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setBrowseOpen(false); }}>
          <div className="modal-box forge-browse-modal">
            <div className="modal-header">
              <strong>{t("browse.title")}</strong>
              <button onClick={() => setBrowseOpen(false)} title={t("common.close")}>✕</button>
            </div>

            <div className="forge-browse-controls">
              <input
                type="text"
                placeholder={t("browse.searchPlaceholder")}
                value={browseQuery}
                onChange={(e) => setBrowseQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runForgeSearch(1); }}
              />
              <button onClick={() => runForgeSearch(1)} disabled={browseLoading} className="primary">
                {browseLoading ? t("browse.searching") : t("browse.searchButton")}
              </button>
              {/* Fileira própria: sem ela, cada filtro novo empurrava o botão
                  de buscar pra linha de baixo sozinho, parecendo defeito. */}
              <div className="forge-browse-filters">
                <select
                  value={browseSort}
                  onChange={(e) => {
                    const valor = e.target.value as typeof browseSort;
                    setBrowseSort(valor);
                    // Refaz a busca na hora: ordenar é do servidor, então a lista
                    // atual não serve. Volta pra página 1 porque a ordem mudou e a
                    // página 3 da ordem antiga não quer dizer nada na nova.
                    runForgeSearch(1, undefined, undefined, valor);
                  }}
                  title={t("browse.sortTitle")}
                  disabled={browseLoading}
                >
                  <option value="-downloads">{t("browse.sortDownloads")}</option>
                  <option value="-updated_at">{t("browse.sortUpdated")}</option>
                  <option value="-created_at">{t("browse.sortCreated")}</option>
                  <option value="name">{t("browse.sortName")}</option>
                </select>
                <select value={browseCategory} onChange={(e) => setBrowseCategory(e.target.value)} title={t("browse.categoryFilterTitle")}>
                  <option value="">{t("browse.allCategories")}</option>
                  {browseCategories.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.title}</option>
                  ))}
                </select>
                {/* Era um checkbox (exato ou nada). Virou seletor com o meio-termo
                    da mesma linha (4.1.x), pedido da comunidade. */}
                <select
                  value={browseCompat}
                  title={t("browse.compatibleOnlyTitle")}
                  disabled={!sptVersionInput.trim() || browseLoading}
                  onChange={(e) => {
                    const modo = e.target.value as CompatFilter;
                    setBrowseCompat(modo);
                    // Filtro do servidor: refaz a busca na hora.
                    if (browseResults.length > 0 || browseQuery.trim()) runForgeSearch(1, modo);
                  }}
                >
                  <option value="all">{t("browse.compatAll")}</option>
                  <option value="exact">
                    {t("browse.compatibleOnlyLabel", { version: sptVersionInput.trim() || t("browse.selectVersionPlaceholder") })}
                  </option>
                  <option value="minor">{t("browse.compatMinor", { version: minorLabel(sptVersionInput) })}</option>
                </select>
                <label className="forge-browse-checkbox" title={t("browse.hideInstalledTitle")}>
                  <input
                    type="checkbox"
                    checked={browseHideInstalled}
                    onChange={(e) => {
                      setBrowseHideInstalled(e.target.checked);
                      // Refaz a busca porque o tamanho da página muda junto: sem
                      // isso, esconder numa página de 24 deixaria quase nada.
                      if (browseResults.length > 0 || browseQuery.trim()) {
                        runForgeSearch(1, browseCompat, e.target.checked);
                      }
                    }}
                    disabled={browseLoading}
                  />
                  {t("browse.hideInstalled")}
                </label>
                <label className="forge-browse-checkbox" title={t("browse.fikaOnlyTitle")}>
                  <input
                    type="checkbox"
                    checked={browseFikaOnly}
                    onChange={(e) => {
                      setBrowseFikaOnly(e.target.checked);
                      // Filtro do servidor, igual ao de compatibilidade: refaz na hora.
                      if (browseResults.length > 0 || browseQuery.trim()) {
                        runForgeSearch(1, undefined, undefined, undefined, e.target.checked);
                      }
                    }}
                    disabled={browseLoading}
                  />
                  {t("browse.fikaOnly")}
                </label>
              </div>
            </div>

            {browseError && <p className="compare-note">{browseError}</p>}
            {browseHideInstalled &&
              !browseLoading &&
              browseResults.length > 0 &&
              browseResults.every((m) => m.installed) && (
                // Acontece com quem tem muita coisa instalada: mesmo pedindo a
                // página maior, tudo que veio já está instalado. Sem este aviso
                // parece busca sem resultado.
                <p className="compare-note">{t("browse.allInstalledOnPage")}</p>
              )}


            <div className="forge-browse-results">
              {!browseLoading && browseResults.length === 0 && !browseError && (
                <p className="compare-note">{t("browse.noResults")}</p>
              )}
              {browseResults
              .filter((mod) => !(browseHideInstalled && mod.installed))
              .map((mod) => {
                const selectedId = selectedVersionByModId.get(mod.id) ?? mod.compatibleVersionId ?? mod.versions[0]?.id;
                return (
                  <div key={mod.id} className="forge-mod-card">
                    <ForgeThumb src={mod.thumbnail} />
                    <div className="forge-mod-info">
                      <div className="forge-mod-title-row">
                        <a
                          href={mod.detailUrl}
                          onClick={(e) => {
                            e.preventDefault();
                            // Abre a PÁGINA DO MOD. Antes chamava openModHub(), que leva
                            // pra raiz do site — o detailUrl estava no href e era ignorado
                            // no clique. Sem o detailUrl (fonte que não devolve o campo),
                            // a raiz do site continua sendo melhor que não fazer nada.
                            if (mod.detailUrl) window.modManagerAPI.openReleasePage(mod.detailUrl);
                            else window.modManagerAPI.openModHub();
                          }}
                          title={t("browse.viewOnForgeTitle")}
                        >
                          {mod.name}
                        </a>
                        {mod.category && <span className="meta-chip">{mod.category}</span>}
                        {mod.fikaCompatible && (
                          <span className="meta-chip forge-chip-fika" title={t("browse.fikaCompatibleTitle")}>
                            {/* U+FE0E força o desenho monocromático: sem ele o
                                sistema escolhe o emoji colorido, que brigaria
                                com o resto da barra. */}
                            Fika&#x2615;&#xFE0E;
                          </span>
                        )}
                        {(() => {
                          const selectedId = selectedVersionByModId.get(mod.id) ?? mod.compatibleVersionId ?? mod.versions[0]?.id;
                          const selected = mod.versions.find((v) => v.id === selectedId);
                          if (selected?.compatibility !== "incompatible") return null;
                          return (
                            <span className="meta-chip forge-chip-incompatible" title={t("browse.incompatibleTitle", { constraint: selected.sptConstraint || "?" })}>
                              {t("browse.incompatible")}
                            </span>
                          );
                        })()}
                        {(() => {
                          // Selo de dependência. O tom segue a mesma regra do
                          // diálogo: âmbar quando falta algo, cinza quando está
                          // tudo satisfeito. Um selo sempre âmbar alarmaria à
                          // toa — o usuário clicaria e o diálogo nem abriria.
                          const vId = selectedVersionByModId.get(mod.id) ?? mod.compatibleVersionId ?? mod.versions[0]?.id;
                          const v = mod.versions.find((x) => x.id === vId);
                          const deps = v ? depsPorChave[`${mod.id}:${v.version}`] : undefined;
                          if (!deps || deps.length === 0) return null;
                          // Faltando e desatualizada são situações diferentes e
                          // precisam de rótulos diferentes: "1 dependência" lido
                          // sobre uma lib que você TEM, só numa versão antiga,
                          // parece erro do app.
                          const faltando = deps.filter((d) => d.status === "missing" || d.status === "unavailable").length;
                          const desatualizadas = deps.filter((d) => d.status === "outdated").length;
                          const classe =
                            faltando > 0
                              ? " forge-chip-deps-pending"
                              : desatualizadas > 0
                                ? " forge-chip-deps-outdated"
                                : "";
                          const rotulo =
                            faltando > 0
                              ? t("browse.depsPending", { count: String(faltando) })
                              : desatualizadas > 0
                                ? t("browse.depsOutdated", { count: String(desatualizadas) })
                                : t("browse.depsSatisfied", { count: String(deps.length) });
                          return (
                            <span
                              className={`meta-chip forge-chip-deps${classe}`}
                              title={deps.map((d) => `${d.name}${d.status === "outdated" ? ` (${d.installedVersion} → ${d.version})` : ""}`).join(", ")}
                            >
                              {rotulo}
                            </span>
                          );
                        })()}
                        {mod.installed && (
                          <span className="meta-chip forge-chip-installed" title={t("browse.installedTitle")}>
                            {mod.installedVersion
                              ? t("browse.installedWithVersion", { version: mod.installedVersion })
                              : t("browse.installed")}
                          </span>
                        )}
                      </div>
                      {mod.teaser && <p className="forge-mod-teaser">{mod.teaser}</p>}
                      <div className="forge-mod-meta">
                        {mod.author && <span>{t("browse.byAuthor", { author: mod.author })}</span>}
                        <span>{mod.downloads.toLocaleString(lang)} {t("browse.downloadsLabel")}</span>
                      </div>
                    </div>
                    <div className="forge-mod-install">
                      {mod.versions.length > 0 ? (
                        <>
                          <select
                            value={selectedId}
                            onChange={(e) => handleSelectVersion(mod.id, Number(e.target.value))}
                            title={t("browse.chooseVersionTitle")}
                          >
                            {mod.versions.map((v) => (
                              <option key={v.id} value={v.id}>
                                v{v.version}{v.sptConstraint ? ` (SPT ${v.sptConstraint})` : ""}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => handleInstallFromForge(mod)} disabled={installingModIds.has(mod.id)} className="primary">
                            {installingModIds.has(mod.id)
                              ? t("browse.installing")
                              : mod.installed
                                ? t("browse.reinstallButton")
                                : t("browse.installButton")}
                          </button>
                        </>
                      ) : (
                        <span className="forge-mod-no-version">{t("browse.noVersionPublishedShort")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {browseLastPage > 1 && (
              <div className="forge-browse-pagination">
                <button onClick={() => runForgeSearch(browsePage - 1)} disabled={browsePage <= 1 || browseLoading}>{t("browse.prevPage")}</button>
                <span>{t("browse.pageOf", { page: browsePage, lastPage: browseLastPage })}</span>
                <button onClick={() => runForgeSearch(browsePage + 1)} disabled={browsePage >= browseLastPage || browseLoading}>{t("browse.nextPage")}</button>
              </div>
            )}

            <p className="compare-note">{t("browse.installNote")}</p>
          </div>
        </div>
      )}

      {/* pointer-events: none no CSS: as faixas são só aviso, o soltar tem que
          continuar chegando nas categorias que estão por baixo delas. */}
      <div ref={faixaCima} className="drag-scroll-zone drag-scroll-up" style={{ height: ZONA_ROLAGEM_PX }} aria-hidden="true">
        <span>▲</span>
      </div>
      <div ref={faixaBaixo} className="drag-scroll-zone drag-scroll-down" style={{ height: ZONA_ROLAGEM_PX }} aria-hidden="true">
        <span>▼</span>
      </div>

      {boasVindas && (
        <div className="modal-backdrop">
          <div className="modal-box welcome-box">
            <h2 className="welcome-title">{t("welcome.title")}</h2>
            <p className="settings-note">{t("welcome.pickLanguage")}</p>
            {/* Já vem marcado o idioma do Windows (detectSystemLang); a pessoa só
                confirma. Trocar aqui muda a interface na hora, inclusive esta caixa. */}
            <div className="welcome-langs">
              {SUPPORTED_LANGS.map((code) => (
                <button key={code} className={lang === code ? "on" : ""} onClick={() => changeLang(code)}>
                  {LANG_LABELS[code]}
                </button>
              ))}
            </div>
            <p className="settings-note">
              {t("credits.translations")}{" "}
              <button
                className="link-button welcome-credit"
                onClick={() => window.modManagerAPI.openReleasePage("https://github.com/GAVRIEL-911")}
              >
                GΛVRIEL
              </button>
            </p>
            <div className="welcome-actions">
              <button className="primary" autoFocus onClick={() => { changeLang(lang); concluirBoasVindas(); }}>
                {t("welcome.continue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {configAberta && (
        <div className="modal-backdrop settings-backdrop" onClick={() => setConfigAberta(false)}>
          <aside className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h2>{t("settings.title")}</h2>
              <button className="link-button settings-close" onClick={() => setConfigAberta(false)} aria-label={t("common.close")}>
                ✕
              </button>
            </div>

            {sptPath && (
              <section className="settings-section">
                <h3>{t("settings.instance")}</h3>
                <div className="settings-row">
                  <span>{t("settings.clientPath")}</span>
                  <span className="settings-value mono" title={sptPath}>{sptPath}</span>
                </div>
                {isSplitInstance && (
                  <div className="settings-row">
                    <span>{t("settings.serverPath")}</span>
                    <span className="settings-value mono" title={serverRoot ?? ""}>{serverRoot}</span>
                  </div>
                )}
                <div className="settings-row">
                  <span>{t("settings.sptVersion")}</span>
                  <span className="settings-value mono">{sptSemverConfig || t("settings.unknown")}</span>
                </div>
                {sptVersion && (
                  <div className="settings-row">
                    <span>{t("settings.gameVersion")}</span>
                    {/* O texto vem como "Tarkov 0.16.9.40743": o rótulo já diz o que é. */}
                    <span className="settings-value mono">{sptVersion.replace(/^Tarkov\s+/i, "")}</span>
                  </div>
                )}
                <div className="settings-row settings-row-end">
                  <button
                    onClick={() => {
                      setConfigAberta(false);
                      handleSelectFolder();
                    }}
                    title={t("header.changeInstanceTitle")}
                  >
                    {t("header.changeInstance")}
                  </button>
                </div>
              </section>
            )}

            <section className="settings-section">
              <h3>{t("settings.appearance")}</h3>
              <div className="settings-block">
                <span className="settings-block-label">{t("settings.theme")}</span>
                <div className="theme-grid" role="radiogroup" aria-label={t("settings.theme")}>
                  {TEMAS.map((opcao) => {
                    // "Sistema" mostra as duas metades: escuro e claro.
                    const a = AMOSTRAS[opcao === "system" ? "dark" : opcao];
                    const b = opcao === "system" ? AMOSTRAS.light : a;
                    return (
                      <button
                        key={opcao}
                        role="radio"
                        aria-checked={tema === opcao}
                        className={`theme-option ${tema === opcao ? "on" : ""}`}
                        onClick={() => mudarTema(opcao)}
                      >
                        <span
                          className="theme-preview"
                          aria-hidden="true"
                          style={{ background: `linear-gradient(135deg, ${a.bg} 50%, ${b.bg} 50%)` }}
                        >
                          <span className="theme-preview-panel" style={{ background: a.panel, color: a.text }}>
                            Aa
                          </span>
                          <span className="theme-preview-dot" style={{ background: destaque ?? a.accent }} />
                        </span>
                        <span className="theme-option-name">{t(NOMES_TEMA[opcao])}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="settings-block">
                <span className="settings-block-label">{t("settings.accent")}</span>
                <div className="accent-row" role="radiogroup" aria-label={t("settings.accent")}>
                  <button
                    role="radio"
                    aria-checked={destaque === null}
                    className={`accent-default ${destaque === null ? "on" : ""}`}
                    onClick={() => mudarDestaque(null)}
                    title={t("settings.accentDefaultTitle")}
                  >
                    {t("settings.accentDefault")}
                  </button>
                  {ACCENT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={destaque === p.hex}
                      aria-label={t(`settings.accent.${p.id}`)}
                      title={t(`settings.accent.${p.id}`)}
                      className={`accent-swatch ${destaque === p.hex ? "on" : ""}`}
                      style={{ background: p.hex }}
                      onClick={() => mudarDestaque(p.hex)}
                    />
                  ))}
                  <label
                    className={`accent-custom ${destaque && !ACCENT_PRESETS.some((p) => p.hex === destaque) ? "on" : ""}`}
                    title={t("settings.accentCustomTitle")}
                  >
                    <input
                      type="color"
                      value={destaque ?? "#c8752e"}
                      onChange={(e) => mudarDestaque(e.target.value)}
                      aria-label={t("settings.accentCustomTitle")}
                    />
                    <span>{t("settings.accentCustom")}</span>
                  </label>
                </div>
                <p className="settings-note">{t("settings.accentNote")}</p>
              </div>
              <div className="settings-row">
                <span>{t("settings.colorblind")}</span>
                <div className="segmented" role="radiogroup" aria-label={t("settings.colorblind")}>
                  {([true, false] as const).map((ligado) => (
                    <button
                      key={String(ligado)}
                      role="radio"
                      aria-checked={daltonico === ligado}
                      className={daltonico === ligado ? "on" : ""}
                      onClick={() => mudarDaltonico(ligado)}
                    >
                      {t(ligado ? "settings.on" : "settings.off")}
                    </button>
                  ))}
                </div>
              </div>
              <p className="settings-note">{t("settings.colorblindNote")}</p>
              {aceleracao && (
                <>
                  <div className="settings-row">
                    <span>{t("settings.hwAccel")}</span>
                    <div className="segmented" role="radiogroup" aria-label={t("settings.hwAccel")}>
                      {([true, false] as const).map((ligada) => (
                        <button
                          key={String(ligada)}
                          role="radio"
                          aria-checked={aceleracao.enabled === ligada}
                          className={aceleracao.enabled === ligada ? "on" : ""}
                          onClick={() => void mudarAceleracao(ligada)}
                        >
                          {t(ligada ? "settings.hwOn" : "settings.hwOff")}
                        </button>
                      ))}
                    </div>
                  </div>
                  {aceleracao.enabled !== aceleracao.active && (
                    <div className="settings-row settings-row-end">
                      <span className="settings-value">{t("settings.hwAccelPending")}</span>
                      <button onClick={() => void reiniciarApp()}>{t("settings.restartNow")}</button>
                    </div>
                  )}
                  <p className="settings-note">{t("settings.hwAccelNote")}</p>
                </>
              )}
              <div className="settings-row">
                <span>{t("settings.animations")}</span>
                <div className="segmented" role="radiogroup" aria-label={t("settings.animations")}>
                  {([true, false] as const).map((ligadas) => (
                    <button
                      key={String(ligadas)}
                      role="radio"
                      aria-checked={animacoesLigadas === ligadas}
                      className={animacoesLigadas === ligadas ? "on" : ""}
                      onClick={() => mudarAnimacoes(ligadas)}
                    >
                      {t(ligadas ? "settings.on" : "settings.off")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span>{t("settings.language")}</span>
                <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label={t("settings.language")}>
                  {SUPPORTED_LANGS.map((code) => (
                    <option key={code} value={code}>{LANG_LABELS[code]}</option>
                  ))}
                </select>
              </div>
              <p className="settings-note">
                {t("credits.translations")}{" "}
                <button
                  className="link-button"
                  onClick={() => window.modManagerAPI.openReleasePage("https://github.com/GAVRIEL-911")}
                >
                  GΛVRIEL
                </button>
              </p>
            </section>

            <section className="settings-section">
              <h3>{t("settings.mods")}</h3>
              <div className="settings-row">
                <span>{t("settings.modSource")}</span>
                <select
                  value={activeSourceKey}
                  onChange={(e) => handleChangeSource(e.target.value)}
                  title={t("browse.sourceTitle")}
                >
                  {modSources.map((src) => (
                    <option key={src.key} value={src.key}>{src.label}</option>
                  ))}
                </select>
              </div>
              {/* A fonte mora só aqui. No Browse ela parecia um filtro da busca,
                  mas também decide de onde vem a checagem de atualizações. */}
              <p className="settings-note">{t("browse.sourceNote")}</p>
              <div className="settings-row">
                <span>{t("settings.downloadCache")}</span>
                <select
                  value={cacheInfo?.limitGB ?? 5}
                  disabled={!cacheInfo}
                  onChange={(e) => void mudarLimiteCache(Number(e.target.value))}
                  aria-label={t("settings.downloadCache")}
                >
                  {DOWNLOAD_CACHE_OPTIONS_GB.map((gb) => (
                    <option key={gb} value={gb}>{gb === 0 ? t("settings.cacheOff") : `${gb} GB`}</option>
                  ))}
                </select>
              </div>
              {cacheInfo && cacheInfo.limitGB > 0 && (
                <div className="settings-row">
                  <span className="settings-value">
                    {t("settings.cacheUsage", { size: formatBytes(cacheInfo.usedBytes), count: cacheInfo.count })}
                  </span>
                  <button onClick={() => void limparCache()} disabled={limpandoCache || cacheInfo.count === 0}>
                    {t("settings.cacheClear")}
                  </button>
                </div>
              )}
              <p className="settings-note">{t("settings.cacheNote")}</p>
              <div className="settings-row">
                <span>{t("settings.maxDownloads")}</span>
                <select
                  value={maxDownloadsSel ?? 1}
                  disabled={maxDownloadsSel === null}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    void window.modManagerAPI.setMaxDownloads(n).then(setMaxDownloadsSel).catch(() => undefined);
                  }}
                  aria-label={t("settings.maxDownloads")}
                >
                  {MAX_DOWNLOADS_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <p className="settings-note">{t("settings.maxDownloadsNote")}</p>
            </section>

            <section className="settings-section">
              <h3>{t("settings.about")}</h3>
              <div className="settings-row">
                <span>SPT Mod Manager</span>
                <span className="settings-value mono">{versaoApp ?? ""}</span>
              </div>
              <div className="settings-row settings-row-end">
                {checagemApp === "done" && appUpdate && (
                  <span className="settings-note">
                    {appUpdate.updateAvailable
                      ? t("settings.updateAvailable", { version: appUpdate.latestVersion ?? "" })
                      : t("settings.upToDate")}
                  </span>
                )}
                {checagemApp === "failed" && <span className="settings-note">{t("settings.updateCheckFailed")}</span>}
                <button onClick={verificarAtualizacaoDoApp} disabled={checagemApp === "checking"}>
                  {checagemApp === "checking" ? t("settings.checking") : t("settings.checkAppUpdate")}
                </button>
              </div>
              {/* Discreto de propósito: fica no Sobre, onde só chega quem foi
                  procurar, e nunca aparece como aviso na tela principal. */}
              <div className="settings-support">
                <p className="settings-note">{t("settings.supportNote")}</p>
                <button className="kofi-button" onClick={() => window.modManagerAPI.openReleasePage(KOFI_URL)}>
                  ☕ {t("settings.supportButton")}
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}

      {erroAberto && (
        <div className="modal-backdrop" onClick={() => setErroAberto(null)}>
          <div className="modal-box error-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="error-box-title">{t("error.title")}</h3>
            <p className="confirm-message">{erroAberto.texto}</p>
            <p className="error-box-label">{t("error.technical")}</p>
            <pre className="error-box-report">{erroAberto.relato}</pre>
            <p className="error-box-hint">{t("error.hint")}</p>
            <div className="confirm-structure-actions error-box-actions">
              <button className="primary" autoFocus onClick={copiarErro}>
                {erroCopiado ? t("error.copied") : t("error.copy")}
              </button>
              {diagnostico?.reportPage && (
                <button onClick={() => window.modManagerAPI.openReleasePage(diagnostico.reportPage!)}>
                  {t("error.reportPage")}
                </button>
              )}
              <button onClick={() => window.modManagerAPI.openReleasePage(urlIssueGithub(erroAberto.raw, erroAberto.relato))}>
                {t("error.reportGithub")}
              </button>
              <button onClick={() => setErroAberto(null)}>{t("common.close")}</button>
            </div>
          </div>
        </div>
      )}

      {pedido && (
        <div className="modal-backdrop">
          <div className="modal-box link-modal">
            <div className="modal-header">
              <strong>{pedido.titulo}</strong>
            </div>
            {pedido.dica && <p className="compare-note">{pedido.dica}</p>}
            <label className="link-field">
              <input
                type="text"
                autoFocus
                maxLength={60}
                value={pedido.valor}
                onChange={(e) => setPedido({ ...pedido, valor: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (pedido.vazioOk || pedido.valor.trim())) {
                    pedido.responder(pedido.valor);
                    setPedido(null);
                  }
                  if (e.key === "Escape") {
                    pedido.responder(null);
                    setPedido(null);
                  }
                }}
              />
            </label>
            <div className="confirm-structure-actions">
              <button
                onClick={() => {
                  pedido.responder(null);
                  setPedido(null);
                }}
              >
                {t("confirm.abort")}
              </button>
              <button
                className="primary"
                disabled={!pedido.vazioOk && !pedido.valor.trim()}
                onClick={() => {
                  pedido.responder(pedido.valor);
                  setPedido(null);
                }}
              >
                {t("confirm.ok")}
              </button>
            </div>
          </div>
        </div>
      )}

      {linkDialog && (
        <div className="modal-backdrop">
          <div className="modal-box link-modal">
            <div className="modal-header">
              <strong>{t("link.title", { name: linkDialog.name })}</strong>
            </div>
            <p className="compare-note">{t("link.intro")}</p>
            <label className="link-field">
              <span>{t("link.refLabel")}</span>
              <input
                type="text"
                autoFocus
                value={linkDialog.ref}
                placeholder={t("link.refPlaceholder")}
                onChange={(e) => setLinkDialog({ ...linkDialog, ref: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmLinkDialog();
                  if (e.key === "Escape") setLinkDialog(null);
                }}
              />
            </label>
            <label className="link-field">
              <span>{t("link.versionLabel")}</span>
              <input
                type="text"
                value={linkDialog.version}
                placeholder={t("link.versionPlaceholder")}
                onChange={(e) => setLinkDialog({ ...linkDialog, version: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmLinkDialog();
                  if (e.key === "Escape") setLinkDialog(null);
                }}
              />
            </label>
            <div className="confirm-structure-actions">
              <button onClick={() => setLinkDialog(null)}>{t("confirm.abort")}</button>
              <button className="primary" disabled={!linkDialog.ref.trim() || linkDialog.saving} onClick={() => void confirmLinkDialog()}>
                {linkDialog.saving ? t("link.saving") : t("link.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmacao && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <p className="confirm-message">{confirmacao.texto}</p>
            <div className="confirm-structure-actions">
              <button
                onClick={() => {
                  confirmacao.responder(false);
                  setConfirmacao(null);
                }}
              >
                {t("confirm.abort")}
              </button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  confirmacao.responder(true);
                  setConfirmacao(null);
                }}
              >
                {t("confirm.ok")}
              </button>
            </div>
          </div>
        </div>
      )}

      {depPrompt && (
        <div className="modal-backdrop">
          <div className="modal-box deps-modal">
            <div className="modal-header">
              <strong>{t("deps.title")}</strong>
            </div>
            <p className="compare-note">
              {t("deps.intro", { name: `${depPrompt.mod.name} ${depPrompt.version.version}` })}
            </p>
            <ul className="deps-list">
              {depPrompt.deps.map((d) => {
                const satisfeita = d.status === "installed";
                const detalhe =
                  d.status === "missing"
                    ? `${t("deps.missing")} · ${t("deps.willDownload", { version: d.version ?? "" })}`
                    : d.status === "outdated"
                      ? `${t("deps.installedAt", { version: d.installedVersion ?? "" })} · ${t("deps.willUpdate", { version: d.version ?? "" })}`
                      : d.status === "unavailable"
                        ? `${t("deps.missing")} · ${t("deps.noCompatible")}`
                        : `${t("deps.installedAt", { version: d.installedVersion ?? "" })} · ${t("deps.satisfied")}`;
                return (
                  <li key={d.guid} className={`dep-row dep-${d.status}`}>
                    <span className="dep-icon" aria-hidden="true" />
                    <span className="dep-text">
                      <span className="dep-name">{d.name}</span>
                      <span className="dep-detail">
                        {detalhe}
                        {d.sizeBytes && !satisfeita ? ` · ${formataTamanho(d.sizeBytes)}` : ""}
                      </span>
                      {/* Quem mais usa a lib. Só aparece quando vai MUDAR algo:
                          atualizar uma lib compartilhada pode tirar outro mod da
                          versão que o autor dele testou, e o usuário merece
                          saber disso antes de clicar. */}
                      {d.status === "outdated" && d.usedBy && d.usedBy.length > 0 && (
                        <span className="dep-usedby">
                          {t("deps.alsoUsedBy", { mods: d.usedBy.join(", ") })}
                        </span>
                      )}
                    </span>
                    {!satisfeita && (
                      <span className="dep-chip">
                        {d.status === "missing"
                          ? t("deps.chipMissing")
                          : d.status === "outdated"
                            ? t("deps.chipOutdated")
                            : t("deps.chipUnavailable")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {(() => {
              // Só conta o que vai realmente ser baixado: dependência já
              // satisfeita e a sem versão compatível não entram na conta.
              const total = depPrompt.deps
                .filter((d) => (d.status === "missing" || d.status === "outdated") && d.downloadLink)
                .reduce((soma, d) => soma + (d.sizeBytes ?? 0), 0);
              return total > 0 ? (
                <p className="deps-total">{t("deps.total", { size: formataTamanho(total) })}</p>
              ) : null;
            })()}
            <div className="confirm-structure-actions">
              <button onClick={() => setDepPrompt(null)}>{t("confirm.abort")}</button>
              <button
                onClick={() => {
                  const p = depPrompt;
                  setDepPrompt(null);
                  void executarInstalacao(p.mod, p.version, []);
                }}
              >
                {t("deps.onlyThis")}
              </button>
              <button
                className="primary"
                onClick={() => {
                  const p = depPrompt;
                  setDepPrompt(null);
                  void executarInstalacao(
                    p.mod,
                    p.version,
                    p.deps.filter((d) => (d.status === "missing" || d.status === "outdated") && d.downloadLink)
                  );
                }}
              >
                {t("deps.installAll")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <div className="modal-backdrop">
          <div className="modal-box confirm-structure-modal">
            <div className="modal-header">
              <strong>{t("confirm.title")}</strong>
            </div>
            <p className="compare-note">
              {t("confirm.descriptionPrefix")} <code>package.json</code> {t("confirm.descriptionMid")} <code>user</code>/<code>BepInEx</code> {t("confirm.descriptionSuffix")}
            </p>
            <ul className="confirm-structure-list">
              {pendingConfirm.rootEntries.length > 0 ? (
                pendingConfirm.rootEntries.map((entry) => <li key={entry}>{entry}</li>)
              ) : (
                <li className="empty-list">{t("confirm.emptyArchive")}</li>
              )}
            </ul>
            <p className="compare-note">{t("confirm.explanation")}</p>
            <div className="confirm-structure-actions">
              <button onClick={handleConfirmAbort}>{t("confirm.abort")}</button>
              <button onClick={handleConfirmProceed} className="primary">{t("confirm.proceed")}</button>
            </div>
          </div>
        </div>
      )}

      {perguntaLote && (
        <div className="modal-backdrop chain-cancel-backdrop" onClick={() => setPerguntaLote(null)}>
          <div className="modal-box chain-cancel-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <strong>{t("queue.chainTitle", { name: perguntaLote.principal })}</strong>
            </div>
            <p className="compare-note">
              {t("queue.chainBody", { dep: perguntaLote.dep, name: perguntaLote.principal })}
            </p>
            <div className="confirm-structure-actions">
              <button onClick={() => setPerguntaLote(null)}>{t("queue.chainBack")}</button>
              <button onClick={() => responderPerguntaLote(false)}>{t("queue.chainOnlyDep", { dep: perguntaLote.dep })}</button>
              <button className="primary" onClick={() => responderPerguntaLote(true)}>
                {t("queue.chainBoth")}
              </button>
            </div>
          </div>
        </div>
      )}

    </ChangelogI18n.Provider>
  );
}

function ModList({
  nodes,
  numberOffset = 0,
  categoryMenu,
  onToggle,
  onUninstall,
  onOpenFolder,
  onOpenModPage,
  onReinstall,
  onLinkModPage,
  onSetVersion,
  onClearLink,
  onRenameStart,
  onRenameCancel,
  onRenameConfirm,
  editingKey,
  editingValue,
  onEditingValueChange,
  selectedKeys,
  onToggleSelect,
  onRangeSelect,
  openMenuKey,
  onSetOpenMenuKey,
  disabled = false,
  forgeStatusByName,
  isExpanded,
  toggleExpanded,
  t
}: {
  nodes: ModTreeNode[];
  isExpanded: (node: ModTreeNode) => boolean;
  toggleExpanded: (node: ModTreeNode) => void;
  /** Numeração contínua entre categorias: a segunda começa onde a primeira parou. */
  numberOffset?: number;
  categoryMenu?: {
    options: { id: string; name: string }[];
    currentOf: (nodeKey: string) => string;
    onMove: (nodeKey: string, categoryId: string) => void;
  };
  onToggle: (mod: ModInfo) => void;
  onUninstall: (mod: ModInfo) => void;
  onOpenFolder: (mod: ModInfo) => void;
  onOpenModPage: (modId: number) => void;
  onReinstall: (mod: ModInfo) => void;
  onLinkModPage: (node: ModTreeNode) => void;
  onSetVersion: (node: ModTreeNode) => void;
  onClearLink: (node: ModTreeNode) => void;
  onRenameStart: (mod: ModInfo) => void;
  onRenameCancel: () => void;
  onRenameConfirm: (mod: ModInfo) => void;
  editingKey: string | null;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  selectedKeys: Set<string>;
  onToggleSelect: (mod: ModInfo) => void;
  onRangeSelect: (keys: string[]) => void;
  openMenuKey: string | null;
  onSetOpenMenuKey: (key: string | null) => void;
  disabled?: boolean;
  forgeStatusByName?: Map<string, ForgeStatusInfo>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  if (nodes.length === 0) {
    return <p className="empty-list">{t("modlist.emptyCategory")}</p>;
  }

  function handleCheckboxClick(e: ReactMouseEvent<HTMLInputElement>, mod: ModInfo, index: number) {
    if (e.shiftKey && lastClickedIndex !== null) {
      const [start, end] = lastClickedIndex < index ? [lastClickedIndex, index] : [index, lastClickedIndex];
      // O intervalo percorre as linhas VISÍVEIS (uma por linha-pai), não as
      // pastas: shift-clique entre a 1ª e a 3ª linha pega 3 mods, e um mod de
      // duas partes entra inteiro.
      onRangeSelect(nodes.slice(start, end + 1).flatMap((n) => n.parts.map(selectionKey)));
    } else {
      onToggleSelect(mod);
    }
    setLastClickedIndex(index);
  }

  return (
    <ul className="mod-list">
      {nodes.map((node, index) => {
        // A linha-pai age sobre a primeira parte. Como habilitar/desabilitar já
        // cascateia pelo pacote, isso vale pelo pacote inteiro.
        const mod = node.parts[0];
        const key = selectionKey(mod);
        const isEditing = editingKey === key;
        const isMenuOpen = openMenuKey === key;
        const forgeStatus = forgeStatusByName?.get(mod.name);
        const expanded = isExpanded(node);
        return (
          <Fragment key={node.key}>
          <li
            className={`mod-item ${mod.enabled ? "" : "disabled"} ${categoryMenu ? "draggable" : ""}`}
            // Arrastável só em "Minhas categorias": nos outros modos não há pra onde soltar.
            draggable={!!categoryMenu && !isEditing}
            onDragStart={(e) => {
              if (!categoryMenu) return;
              e.dataTransfer.setData(ARRASTO_MOD, node.key);
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            <input
              type="checkbox"
              checked={selectedKeys.has(key)}
              onClick={(e) => handleCheckboxClick(e, mod, index)}
              onChange={() => {}}
              className="mod-checkbox"
              disabled={disabled}
              title={t("modlist.checkboxTitle")}
            />
            <span className="mod-number">{String(numberOffset + index + 1).padStart(2, "0")}</span>
            {node.single ? (
              <span className="tree-toggle-spacer" />
            ) : (
              <button
                className="tree-toggle"
                onClick={() => toggleExpanded(node)}
                aria-expanded={expanded}
                title={t(expanded ? "modlist.collapseParts" : "modlist.expandParts")}
              >
                <span className={`tree-toggle-icon ${expanded ? "open" : ""}`}>▸</span>
              </button>
            )}
            <div className="mod-info">
              {isEditing ? (
                <input
                  className="rename-input"
                  autoFocus
                  value={editingValue}
                  onChange={(e) => onEditingValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameConfirm(mod);
                    if (e.key === "Escape") onRenameCancel();
                  }}
                  onBlur={() => onRenameConfirm(mod)}
                />
              ) : (
                <span
                  className="mod-name"
                  title={node.single ? t("modlist.renameTitle", { name: mod.originalName }) : node.name}
                  onDoubleClick={() => node.single && onRenameStart(mod)}
                >
                  {node.name}
                </span>
              )}
              <div className="mod-meta">
                {node.single && <span className={`type-badge type-${mod.type}`}>{mod.type}</span>}
                <span className={`status-chip ${mod.enabled ? "status-chip-on" : "status-chip-off"}`}>
                  {mod.enabled ? t("modlist.statusActive") : t("modlist.statusDisabled")}
                </span>
                <span className="origin-chip">{mod.installedManually ? "Manual" : "Manager"}</span>
                {mod.version && (
                  <span className="meta-chip" title={mod.versionManual ? t("modlist.versionManualTitle") : undefined}>
                    v{mod.version}
                    {mod.versionManual ? "*" : ""}
                  </span>
                )}
                {mod.forgeLinkManual && (
                  <span className="meta-chip" title={t("modlist.linkedManuallyTitle")}>
                    🔗
                  </span>
                )}
                {mod.author && <span className="meta-chip">{t("browse.byAuthor", { author: mod.author })}</span>}
                {forgeStatus?.status === "update" && (
                  <span className="forge-update-group">
                    <span className="meta-chip forge-chip-update" title={t("modlist.forgeUpdateAvailableTitle")}>
                      {t("modlist.forgeUpdateAvailable", { version: forgeStatus.version ?? "" })}
                    </span>
                    {forgeIdOf(node) !== undefined && (
                      <ChangelogButton modId={forgeIdOf(node)!} nome={node.name} de={mod.version} para={forgeStatus.version} />
                    )}
                  </span>
                )}
                {forgeStatus?.status === "blocked" && (
                  <span
                    className="meta-chip forge-chip-blocked"
                    title={
                      forgeStatus.blockedBy
                        ? t("modlist.forgeBlockedByTitle", { version: forgeStatus.version ?? "", who: forgeStatus.blockedBy })
                        : t("modlist.forgeBlockedTitle")
                    }
                  >
                    {t("modlist.forgeBlocked")}
                  </span>
                )}
                {forgeStatus?.status === "incompatible" && (
                  <span className="meta-chip forge-chip-incompatible" title={t("modlist.forgeIncompatibleTitle")}>
                    {t("modlist.forgeIncompatible")}
                  </span>
                )}
                {forgeStatus?.status === "info" && (
                  <span className="meta-chip forge-chip-info" title={t("modlist.forgeInfoTitle")}>
                    {t("modlist.forgeInfo", { version: forgeStatus.version ?? "" })}
                  </span>
                )}
                {mod.sptCompatibility === "incompatible" && (
                  // Mod de servidor: o servidor do SPT 4 confere essa faixa ao subir e,
                  // se UM mod não aceita a versão, não carrega NENHUM (ModValidator).
                  // Por isso o selo dele é mais forte que o de um mod de client.
                  <span
                    className={`meta-chip forge-chip-incompatible ${mod.type === "server" ? "spt-blocks-server" : ""}`}
                    title={t(mod.type === "server" ? "modlist.sptIncompatibleServerTitle" : "modlist.sptIncompatibleTitle", {
                      declared: mod.sptVersion ?? ""
                    })}
                  >
                    {t(mod.type === "server" ? "modlist.sptIncompatibleServer" : "modlist.sptIncompatible")}
                  </span>
                )}
                {!node.single && (
                  <span
                    className={`meta-chip package-chip ${node.inferred ? "package-chip-inferred" : ""}`}
                    title={t(node.inferred ? "modlist.packageTooltipInferred" : "modlist.packageTooltip", {
                      others: node.parts.map((x) => `${x.name} (${x.type})`).join(", ")
                    })}
                  >
                    {node.hiddenParts > 0
                      ? t("modlist.packagePartFiltered", {
                          shown: node.parts.length,
                          count: node.parts.length + node.hiddenParts
                        })
                      : t("modlist.packagePart", { count: node.parts.length })}
                  </span>
                )}
                {mod.manifestOnly && (
                  <span className="meta-chip" title={t("modlist.orphanTitle")}>
                    {t("modlist.orphan")}
                  </span>
                )}
              </div>
            </div>
            <div className="action-menu-wrapper">
              <button className="menu-trigger" onClick={() => onSetOpenMenuKey(isMenuOpen ? null : key)} title={t("modlist.actionsTitle")} disabled={disabled}>
                ⋮
              </button>
              {isMenuOpen && (
                <div className="action-menu">
                  {!mod.manifestOnly && (
                    <button onClick={() => { onToggle(mod); onSetOpenMenuKey(null); }}>
                      {mod.enabled ? t("bulk.disable") : t("bulk.enable")}
                    </button>
                  )}
                  {mod.forgeModId !== undefined && (
                    <button
                      onClick={() => {
                        const id = mod.forgeModId!;
                        onSetOpenMenuKey(null);
                        // O endereço é resolvido pela fonte no clique, então
                        // pode falhar (rede fora, mod removido do catálogo).
                        onOpenModPage(id);
                      }}
                    >
                      {t("modlist.openModPage")}
                    </button>
                  )}
                  {/* Mod de várias partes: uma entrada por metade. A linha-pai age
                      sobre a PRIMEIRA parte, e com uma entrada só o "Abrir pasta"
                      abria sempre a mesma metade (quase sempre o server), sem
                      jeito de chegar na outra pelo app (relato do inganshin). */}
                  {node.single
                    ? !mod.manifestOnly && (
                        <button onClick={() => { onOpenFolder(mod); onSetOpenMenuKey(null); }}>{t("modlist.openFolder")}</button>
                      )
                    : node.parts
                        .filter((part) => !part.manifestOnly)
                        .map((part) => (
                          <button key={`open-${selectionKey(part)}`} onClick={() => { onOpenFolder(part); onSetOpenMenuKey(null); }}>
                            {/* Tipo repetido (o UI Fixes tem dois DLLs de client): aí
                                só o nome diferencia uma entrada da outra. */}
                            {t("modlist.openFolder")} (
                            {node.parts.filter((x) => x.type === part.type).length > 1 ? part.name : part.type})
                          </button>
                        ))}
                  {categoryMenu && (
                    // Select em vez de submenu: com 20 categorias, um submenu que
                    // abre pro lado sai da tela; o select nativo sempre cabe.
                    <select
                      className="menu-category-select"
                      value={categoryMenu.currentOf(node.key)}
                      onChange={(e) => {
                        categoryMenu.onMove(node.key, e.target.value);
                        onSetOpenMenuKey(null);
                      }}
                      aria-label={t("categories.moveTo")}
                      title={t("categories.moveTo")}
                    >
                      {categoryMenu.options.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                      <option value={UNCATEGORIZED}>{t("categories.uncategorized")}</option>
                    </select>
                  )}
                  <button onClick={() => { onLinkModPage(node); onSetOpenMenuKey(null); }} title={t("modlist.linkModPageTitle")}>
                    {mod.forgeLinkManual ? t("modlist.changeLink") : t("modlist.linkModPage")}
                  </button>
                  <button onClick={() => { onSetVersion(node); onSetOpenMenuKey(null); }} title={t("modlist.setVersionTitle")}>
                    {t("modlist.setVersion")}
                  </button>
                  {node.parts.some((x) => x.forgeLinkManual || x.versionManual) && (
                    <button onClick={() => { onClearLink(node); onSetOpenMenuKey(null); }}>{t("modlist.clearLink")}</button>
                  )}
                  <button onClick={() => onRenameStart(mod)}>{t("modlist.rename")}</button>
                  <button onClick={() => { onReinstall(mod); onSetOpenMenuKey(null); }}>{t("modlist.reinstall")}</button>
                  <button className="danger" onClick={() => { onUninstall(mod); onSetOpenMenuKey(null); }}>{t("bulk.remove")}</button>
                </div>
              )}
            </div>
          </li>
          {expanded && (
            // As partes vão num <li> só, como uma faixa dentro do bloco do mod. Uma
            // linha por parte fazia cada uma parecer um mod da lista — e como parte
            // não tem checkbox (habilitar/desabilitar age no pacote inteiro), isso
            // era lido como "esse mod está sem checkbox".
            <li className="mod-parts">
              {node.parts.map((part) => (
                <div key={selectionKey(part)} className={`mod-part ${part.enabled ? "" : "disabled"}`}>
                  <span className="mod-part-elbow" aria-hidden="true" />
                  <span className="mod-part-tag-slot">
                    <span className={`mod-part-tag type-${part.type}`}>{part.type}</span>
                  </span>
                  <span className="mod-part-name" title={part.name}>{part.name}</span>
                </div>
              ))}
            </li>
          )}
          </Fragment>
        );
      })}
    </ul>
  );
}