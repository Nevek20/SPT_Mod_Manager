/**
 * Checagem de atualizações: tamanho da URL e travamento em cadeia.
 *
 * Dois relatos da 0.6.3, mesma parte do código:
 *
 * 1. FlachkopfLarry: `414 URI Too Long`. A lista inteira de mods ia numa única
 *    URL, e o corte que existia era por QUANTIDADE de itens. Quem tem muitos mods
 *    de GUID longo montava uma URL que o servidor recusa antes de ler.
 *
 * 2. hognus: "um monte de mod se recusa a atualizar porque a dependência também
 *    tem atualização". A fonte avalia dependência contra o estado que mandamos,
 *    então A espera a versão nova de B enquanto B ainda está na antiga, e volta
 *    como `chain_dependency_conflict` — travando em par.
 *
 * Aqui o `fetch` global é substituído por um servidor de mentira, pra conferir as
 * URLs que o app monta e o que ele faz com a resposta, sem tocar na rede.
 */

import { fatiarPorTamanho, checkForgeUpdates } from "../electron/modManager";

let ok = 0;
let fail = 0;
const check = (l: string, g: unknown, w: unknown) => {
  if (JSON.stringify(g) === JSON.stringify(w)) {
    ok++;
    console.log("  ok   " + l);
  } else {
    fail++;
    console.log(`  FAIL ${l}\n    esperado ${JSON.stringify(w)}\n    obtido   ${JSON.stringify(g)}`);
  }
};

// ---------------------------------------------------------------------------
console.log("\nfatiamento por tamanho da URL");
// ---------------------------------------------------------------------------
{
  check("lista vazia nao gera fatia", fatiarPorTamanho([]), []);
  check("cabe tudo numa fatia", fatiarPorTamanho(["a", "b", "c"], 100), [["a", "b", "c"]]);

  // "aaaa" tem 4; com separador codificado (%2C, 3 chars) cada item extra custa 7.
  // Limite 12 deixa passar dois (4 + 7 = 11) e corta no terceiro.
  check("corta quando o proximo estouraria o limite", fatiarPorTamanho(["aaaa", "aaaa", "aaaa"], 12), [
    ["aaaa", "aaaa"],
    ["aaaa"]
  ]);

  check("teto de itens tambem vale", fatiarPorTamanho(["a", "b", "c", "d", "e"], 9999, 2), [
    ["a", "b"],
    ["c", "d"],
    ["e"]
  ]);

  // O que importa é o tamanho JÁ CODIFICADO: um GUID com espaço ocupa 3 por espaço.
  const comEspaco = "a b c"; // 5 chars crus, 11 codificados (a%20b%20c)
  check("conta o tamanho depois de codificar", fatiarPorTamanho([comEspaco, comEspaco], 15), [
    [comEspaco],
    [comEspaco]
  ]);

  {
    // Item sozinho maior que o limite vai numa fatia própria em vez de desaparecer.
    const gigante = "x".repeat(50);
    check("item maior que o limite nao e descartado", fatiarPorTamanho([gigante, "y"], 10), [[gigante], ["y"]]);
  }

  {
    // O caso do relato: 200 mods com GUID longo. Nenhuma fatia pode passar do limite.
    const chaves = Array.from({ length: 200 }, (_, i) => `com.autor.mod.muito.longo.numero${i}:1.2.3`);
    const fatias = fatiarPorTamanho(chaves);
    const maior = Math.max(...fatias.map((f) => encodeURIComponent(f.join(",")).length));
    check("nenhuma fatia passa do limite", maior <= 1500, true);
    check("nada se perde no caminho", fatias.flat().length, 200);
    check("mais de uma requisicao, como tem que ser", fatias.length > 1, true);
  }
}

// ---------------------------------------------------------------------------
// Servidor de mentira: responde /mods (casamento por GUID) e /mods/updates.
// ---------------------------------------------------------------------------

/** Catálogo da fonte falsa: GUID -> { id, nome, versões } */
const catalogo: Record<string, { id: number; name: string; versions: string[] }> = {
  "xyz.drakia.bigbrain": { id: 902, name: "BigBrain", versions: ["1.5.0", "1.4.0"] },
  "me.sol.sain": { id: 791, name: "SAIN", versions: ["4.5.1", "4.5.0"] },
  "xyz.drakia.waypoints": { id: 827, name: "Waypoints", versions: ["1.9.0", "1.8.0"] }
};

/** Quem exige o quê: GUID -> [GUID exigido, versão mínima]. */
const exigencias: Record<string, [string, string][]> = {
  // A 4.5.1 do SAIN só funciona com a 1.5.0 do BigBrain. É o caso real.
  "me.sol.sain": [["xyz.drakia.bigbrain", "1.5.0"]]
};

const urlsVistas: string[] = [];

function respondeMods(u: URL) {
  const guids = (u.searchParams.get("filter[guid]") ?? "").split(",").filter(Boolean);
  const data = guids
    .filter((g) => catalogo[g])
    .map((g) => ({
      id: catalogo[g].id,
      guid: g,
      name: catalogo[g].name,
      owner: { name: "autor" },
      versions: catalogo[g].versions.map((v) => ({
        version: v,
        link: `https://fonte/download/${catalogo[g].id}/${v}`
      }))
    }));
  return { success: true, data };
}

function respondeUpdates(u: URL) {
  const estado = new Map<string, string>();
  for (const par of (u.searchParams.get("mods") ?? "").split(",").filter(Boolean)) {
    const corte = par.lastIndexOf(":");
    estado.set(par.slice(0, corte), par.slice(corte + 1));
  }

  const updates: unknown[] = [];
  const blocked: unknown[] = [];
  const upToDate: unknown[] = [];

  for (const [guid, versaoAtual] of estado) {
    const mod = catalogo[guid];
    if (!mod) continue;
    const ultima = mod.versions[0];
    const atual = { id: 1, mod_id: mod.id, guid, name: mod.name, version: versaoAtual };
    if (ultima === versaoAtual) {
      upToDate.push({ id: 1, mod_id: mod.id, guid, name: mod.name, version: versaoAtual });
      continue;
    }
    // Só libera a atualização se TODA exigência dela já estiver satisfeita pelo
    // estado que o cliente mandou. É exatamente assim que a fonte se comporta.
    const faltando = (exigencias[guid] ?? []).some(([dep, min]) => estado.get(dep) !== min);
    if (faltando) {
      blocked.push({
        current_version: atual,
        latest_version: { id: 2, version: ultima },
        block_reason: "chain_dependency_conflict"
      });
      continue;
    }
    updates.push({
      current_version: atual,
      recommended_version: { id: 2, version: ultima, link: `https://fonte/download/${mod.id}/${ultima}` },
      update_reason: "newer_version_available"
    });
  }

  return {
    success: true,
    data: {
      spt_version: u.searchParams.get("spt_version"),
      updates,
      blocked_updates: blocked,
      up_to_date: upToDate,
      incompatible_with_spt: []
    }
  };
}

/** Limite de URL do servidor de mentira: passar disso é 414, como na vida real. */
const LIMITE_URL = 2000;

function instalaFetchFalso() {
  (globalThis as { fetch: unknown }).fetch = async (entrada: unknown) => {
    const bruta = String(entrada);
    urlsVistas.push(bruta);
    if (bruta.length > LIMITE_URL) {
      return new Response("URI Too Long", { status: 414, headers: { "content-type": "text/plain" } });
    }
    const u = new URL(bruta);
    const corpo = u.pathname.endsWith("/mods/updates") ? respondeUpdates(u) : respondeMods(u);
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
}

async function roda(mods: { name: string; version?: string; guid?: string }[]) {
  urlsVistas.length = 0;
  instalaFetchFalso();
  return await checkForgeUpdates(
    mods.map((m) => ({ ...m, originalName: m.name })),
    "4.1.6"
  );
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("\ntravamento em cadeia (relato do hognus)");
  {
    // BigBrain velho e SAIN velho: a atualização do SAIN exige o BigBrain novo.
    // Antes, o SAIN voltava bloqueado pra sempre. Agora os dois aparecem, e o
    // BigBrain vem primeiro — a ordem da lista é a ordem de instalação.
    const r = await roda([
      { name: "SAIN", version: "4.5.0", guid: "me.sol.sain" },
      { name: "BigBrain", version: "1.4.0", guid: "xyz.drakia.bigbrain" }
    ]);
    check("os dois entram como atualizacao", r.updates.map((u) => u.name), ["BigBrain", "SAIN"]);
    check("nada fica bloqueado", r.blocked.length, 0);
    check(
      "o destravado vem com link de download",
      r.updates.every((u) => Boolean(u.downloadLink)),
      true
    );
    check("o destravado e marcado como tal", r.updates.find((u) => u.name === "SAIN")?.reason, "unblocked_after_update");
    check("versao recomendada do destravado", r.updates.find((u) => u.name === "SAIN")?.recommendedVersion, "4.5.1");
  }

  {
    // Dependência já satisfeita: um passe só, nada de requisição extra.
    const r = await roda([
      { name: "SAIN", version: "4.5.0", guid: "me.sol.sain" },
      { name: "BigBrain", version: "1.5.0", guid: "xyz.drakia.bigbrain" }
    ]);
    check("sem bloqueio, nao repete a consulta", urlsVistas.filter((u) => u.includes("/mods/updates")).length, 1);
    check("so o SAIN atualiza", r.updates.map((u) => u.name), ["SAIN"]);
    check("o BigBrain fica em dia", r.upToDate.map((u) => u.name), ["BigBrain"]);
  }

  {
    // Bloqueio que NÃO se resolve: a exigência é de uma versão que não existe.
    exigencias["me.sol.sain"] = [["xyz.drakia.bigbrain", "9.9.9"]];
    const r = await roda([
      { name: "SAIN", version: "4.5.0", guid: "me.sol.sain" },
      { name: "BigBrain", version: "1.4.0", guid: "xyz.drakia.bigbrain" }
    ]);
    check("bloqueio de verdade continua bloqueado", r.blocked.map((b) => b.name), ["SAIN"]);
    check("o motivo e preservado", r.blocked[0]?.reason, "chain_dependency_conflict");
    check("quem da pra atualizar atualiza", r.updates.map((u) => u.name), ["BigBrain"]);
    exigencias["me.sol.sain"] = [["xyz.drakia.bigbrain", "1.5.0"]];
  }

  console.log("\nURL longa (relato do FlachkopfLarry)");
  {
    // 120 mods com GUID longo: antes, uma URL só, e 414. Agora, várias.
    for (let i = 0; i < 120; i++) {
      const guid = `com.algum.autor.com.nome.comprido.mod.numero.${i}`;
      catalogo[guid] = { id: 5000 + i, name: `Mod ${i}`, versions: ["2.0.0", "1.0.0"] };
    }
    const mods = Object.keys(catalogo)
      .filter((g) => g.startsWith("com.algum"))
      .map((g) => ({ name: catalogo[g].name, version: "1.0.0", guid: g }));

    const r = await roda(mods);
    const maior = Math.max(...urlsVistas.map((u) => u.length));
    check("nenhuma URL passa do limite do servidor", maior <= LIMITE_URL, true);
    check("nenhum 414", urlsVistas.every((u) => u.length <= LIMITE_URL), true);
    check("varias requisicoes de atualizacao", urlsVistas.filter((u) => u.includes("/mods/updates")).length > 1, true);
    check("todos os 120 mods voltam com atualizacao", r.updates.length, 120);
    check("nenhum sobrou sem casamento", r.unmatched.length, 0);
  }

  console.log(`\n${ok} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}

void main();
