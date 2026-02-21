import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-password",
};

type FunnelType =
  | "Ativação FTD"
  | "Ativação STD / TTD / 4TD+"
  | "Reativação"
  | "Sazonal";

type Payload = {
  casino: string;
  funnelType: FunnelType;
  tier: string;
  reativacaoRegua?: string;
  days?: Array<{
    mode: "A" | "B";
    gameName?: string;
    buttonCount?: number;
    buttons?: Array<{ text?: string }>;
    freeMessage?: string;
  }>;
  sazonal?: {
    gameName?: string;
    offerDescription?: string;
    includeUpsellDownsell?: boolean;
    upsell?: string;
    downsell?: string;
  };
};

function pickRefKey(payload: Payload): string[] {
  if (payload.funnelType === "Sazonal") return ["ref_sazonal"];
  if (payload.funnelType === "Ativação FTD") return ["ref_ativacao_ftd"];
  if (payload.funnelType === "Ativação STD / TTD / 4TD+") {
    // Referência única para STD em diante
    return ["ref_ativacao_std"];
  }

  // Reativação (simplificada)
  const r = (payload.reativacaoRegua ?? "").trim();
  if (r === "Sem FTD") return ["ref_reativacao_sem_ftd"];
  if (r === "Sem Depósito") return ["ref_reativacao_sem_deposito"];
  if (r === "Sem Login") return ["ref_reativacao_sem_login"];

  return ["ref_reativacao_sem_ftd"];
}

function normalizeCasinoName(v: string) {
  return (v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

function casinoNameCandidates(v: string) {
  const base = normalizeCasinoName(v);
  const candidates = new Set<string>([base]);

  // Se vier como "*-bet", também tenta sem o sufixo "bet".
  // Ex: "ginga-bet" -> "ginga"
  if (base.endsWith("bet") && base.length > 3) {
    candidates.add(base.slice(0, -3));
  }

  return Array.from(candidates).filter(Boolean);
}

function normalizeDays(payload: Payload) {
  const days = payload.days ?? [];

  // Agora aceitamos até 6 dias de inputs do operador.
  return Array.from({ length: 6 }).map((_, i) => {
    const d = days[i] ?? ({} as any);
    const gameName = (d.gameName ?? "").trim();
    const freeMessage = (d.freeMessage ?? "").trim();
    const buttons = (d.buttons ?? [])
      .map((b: any) => (b.text ?? "").trim())
      .filter(Boolean);

    const active = gameName.length > 0 || freeMessage.length > 0 || buttons.length > 0;

    return {
      day: i + 1,
      type: d.mode === "A" ? "Deposite, jogue e ganhe" : "Outro tipo de oferta",
      gameName,
      buttons,
      freeMessage,
      active,
    };
  });
}

function buildBriefingByDay(payload: Payload) {
  const sazonal = payload.sazonal ?? {};
  if (payload.funnelType === "Sazonal") {
    return {
      sazonal: [
        `JOGO: ${(sazonal.gameName ?? "").trim()}`,
        `OFERTA: ${(sazonal.offerDescription ?? "").trim()}`,
        sazonal.includeUpsellDownsell
          ? `UPSELL: ${(sazonal.upsell ?? "").trim()}\nDOWNSELL: ${(sazonal.downsell ?? "").trim()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    } as const;
  }

  const days = normalizeDays(payload);
  const byDay: Record<number, string> = {};

  for (const d of days) {
    const parts = [
      `TIPO_DE_OFERTA: ${d.type}`,
      d.gameName ? `JOGO: ${d.gameName}` : "",
      d.buttons?.length ? `BOTÕES/CTAs: ${d.buttons.join(" | ")}` : "",
      d.freeMessage ? `MENSAGEM_BASE: ${d.freeMessage}` : "",
    ].filter(Boolean);

    byDay[d.day] = parts.join("\n").trim();
  }

  return { byDay } as const;
}

function dayNumberFromChunk(chunk: string) {
  const m = chunk.match(/(?:🔹|🔸)?\s*DIA\s*(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractTemplateDays(template: string) {
  // Aceita variações de marcador: 🔹, 🔸 ou sem emoji, desde que seja início de linha.
  const re = /(?:^|\n)\s*(?:🔹|🔸)?\s*DIA\s*(\d+)/gi;
  const matches = Array.from((template ?? "").matchAll(re));
  const found = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) found.add(n);
  }
  return Array.from(found).sort((a, b) => a - b);
}

function splitTemplateByDays(template: string) {
  const t = (template ?? "").trim();
  if (!t) return [] as string[];

  // Robusto: encontra marcadores mesmo no início do texto.
  // Aceita: "🔹 DIA 1", "🔸 DIA 1" ou "DIA 1".
  const re = /(?:^|\n)\s*(?:🔹|🔸)?\s*DIA\s*\d+/gi;
  const matches = Array.from(t.matchAll(re));
  if (matches.length === 0) return [t];

  const indices = matches
    .map((m) => m.index)
    .filter((i): i is number => typeof i === "number")
    .sort((a, b) => a - b);

  const chunks: string[] = [];
  // preâmbulo (popups + header do funil)
  if (indices[0] > 0) chunks.push(t.slice(0, indices[0]).trim());

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : t.length;
    chunks.push(t.slice(start, end).trim());
  }

  return chunks.filter(Boolean);
}

async function callGeminiFlash(
  prompt: string,
  config?: { maxOutputTokens?: number; temperature?: number },
) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[generate-copy] Missing GEMINI_API_KEY secret");
    return { ok: false, error: "GEMINI_API_KEY não configurada." } as const;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config?.temperature ?? 0.35,
        topP: 0.9,
        maxOutputTokens: config?.maxOutputTokens ?? 8192,
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[generate-copy] Gemini API error", { status: res.status, txt });
    return { ok: false, error: "Falha ao gerar com Gemini." } as const;
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text)
      .filter(Boolean)
      .join("\n") ?? "";

  if (!text || String(text).trim().length === 0) {
    console.error("[generate-copy] Empty Gemini response", { data });
    return { ok: false, error: "Resposta vazia do Gemini." } as const;
  }

  return { ok: true, text: String(text) } as const;
}

function stripMetaOnly(v: string) {
  let out = v ?? "";
  out = out
    .split("\n")
    .filter((line) => {
      const l = line.trim().toLowerCase();
      if (l.startsWith("diagnóstico:")) return false;
      if (l.startsWith("diagnostico:")) return false;
      if (l.startsWith("copy final:")) return false;
      if (l === "copy final") return false;
      return true;
    })
    .join("\n");

  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Proteção simples por senha (para evitar acesso público/links vazados)
  const expectedPassword = Deno.env.get("BETFUNNELS_APP_PASSWORD") ?? "";
  if (!expectedPassword) {
    console.error("[generate-copy] Missing BETFUNNELS_APP_PASSWORD secret");
    return new Response(JSON.stringify({ error: "Senha do app não configurada." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const providedPassword = req.headers.get("x-app-password") ?? "";
  if (providedPassword !== expectedPassword) {
    console.warn("[generate-copy] Unauthorized: invalid app password");
    return new Response(JSON.stringify({ error: "Acesso negado. Senha inválida." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = (await req.json()) as Payload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[generate-copy] Missing Supabase envs", {
        hasUrl: Boolean(supabaseUrl),
        hasServiceRole: Boolean(serviceRoleKey),
      });
      return new Response(JSON.stringify({ error: "Config do Supabase ausente." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: master, error: masterErr } = await supabase
      .from("prompt_master")
      .select("prompt_instrucao")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (masterErr) {
      console.error("[generate-copy] prompt_master error", { masterErr });
      return new Response(JSON.stringify({ error: "Falha ao ler prompt_master." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const masterPrompt = (master?.prompt_instrucao ?? "").trim();
    if (!masterPrompt) {
      console.error("[generate-copy] Missing master prompt");
      return new Response(
        JSON.stringify({
          error:
            "Não é possível gerar: o guia mestre não está configurado (prompt_master.prompt_instrucao).",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const casinoSelect = [
      "nome_casino",
      "tom_voz",
      "prompt_instrucao",
      "ref_ativacao_ftd",
      "ref_ativacao_std",
      "ref_reativacao_sem_ftd",
      "ref_reativacao_sem_deposito",
      "ref_reativacao_sem_login",
      "ref_sazonal",
    ].join(",");

    // 1) Tentativa por match exato
    const { data: casinoExact, error: casinoExactErr } = await supabase
      .from("casino_prompts")
      .select(casinoSelect)
      .eq("nome_casino", payload.casino)
      .maybeSingle();

    if (casinoExactErr) {
      console.error("[generate-copy] casino_prompts exact query error", {
        casinoExactErr,
        casino: payload.casino,
      });
    }

    // 2) Fallback por match normalizado (evita diferença de hífen/espaço/case)
    let casinoRow = casinoExact as any;
    if (!casinoRow) {
      const { data: allCasinos, error: allErr } = await supabase
        .from("casino_prompts")
        .select(casinoSelect);

      if (allErr) {
        console.error("[generate-copy] casino_prompts list error", { allErr });
        return new Response(JSON.stringify({ error: "Falha ao ler casino_prompts." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targets = casinoNameCandidates(payload.casino);
      casinoRow = (allCasinos ?? []).find((r: any) => {
        const rowKey = normalizeCasinoName(r?.nome_casino);
        return targets.includes(rowKey);
      });

      if (!casinoRow) {
        console.warn("[generate-copy] Casino not found", {
          casino: payload.casino,
          targets,
          available: (allCasinos ?? []).map((r: any) => r?.nome_casino),
        });
        return new Response(
          JSON.stringify({
            error: "Casino não encontrado em casino_prompts.",
            casino: payload.casino,
            tried: targets,
            availableCasinos: (allCasinos ?? []).map((r: any) => r?.nome_casino),
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const casinoTone = String(casinoRow.tom_voz ?? "").trim();
    if (!casinoTone) {
      console.error("[generate-copy] Missing casino tone", { casino: payload.casino });
      return new Response(
        JSON.stringify({
          error:
            "Não é possível gerar: tom de voz não configurado para esse cassino (casino_prompts.tom_voz).",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const casinoInstruction = String(casinoRow.prompt_instrucao ?? "").trim();

    const refKeys = pickRefKey(payload);
    const references = refKeys
      .map((k) => (casinoRow as any)?.[k])
      .filter((v) => typeof v === "string" && v.trim().length > 0)
      .map((v) => String(v).trim());

    if (references.length === 0) {
      const refDebug: Record<
        string,
        {
          isNull: boolean;
          length: number;
          trimmedLength: number;
          preview: string | null;
        }
      > = {};

      for (const k of refKeys) {
        const raw = (casinoRow as any)?.[k];
        const str = typeof raw === "string" ? raw : "";
        refDebug[k] = {
          isNull: raw == null,
          length: str.length,
          trimmedLength: str.trim().length,
          preview: str.trim().length ? str.trim().slice(0, 120) : null,
        };
      }

      console.warn("[generate-copy] Missing references for funnel", {
        casino: payload.casino,
        matchedCasino: casinoRow?.nome_casino,
        funnel: payload.funnelType,
        reativacaoRegua: payload.reativacaoRegua,
        refKeys,
        refDebug,
      });

      return new Response(
        JSON.stringify({
          error:
            "Não é possível gerar: falta referência cadastrada para esse cassino/funil (casino_prompts.ref_*).",
          casino: payload.casino,
          matchedCasino: casinoRow?.nome_casino,
          missingRefKeys: refKeys,
          refDebug,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const days = normalizeDays(payload);

    const sazonalActive = payload.funnelType === "Sazonal";
    const sazonal = payload.sazonal ?? {};

    const briefingByDay = buildBriefingByDay(payload);
    const templateFull = references.join("\n\n---\n\n");

    // Se o funil não for Sazonal, esperamos um molde com 6 dias.
    if (payload.funnelType !== "Sazonal") {
      const foundDays = extractTemplateDays(templateFull);
      const expectedDays = [1, 2, 3, 4, 5, 6];
      const missingDays = expectedDays.filter((d) => !foundDays.includes(d));

      if (missingDays.length) {
        console.warn("[generate-copy] Template missing day markers", {
          casino: payload.casino,
          matchedCasino: casinoRow.nome_casino,
          funnel: payload.funnelType,
          reativacaoRegua: payload.reativacaoRegua,
          foundDays,
          missingDays,
        });

        return new Response(
          JSON.stringify({
            error:
              "Referência incompleta: faltam marcadores de DIA no template (🔹 DIA N). Atualize a referência do cassino.",
            foundDays,
            missingDays,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const chunks = splitTemplateByDays(templateFull);

    if (!chunks.length) {
      console.error("[generate-copy] Empty template after split", { refKeys });
      return new Response(JSON.stringify({ error: "Referência vazia/inválida." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[generate-copy] Rewriting template", {
      casino: payload.casino,
      matchedCasino: casinoRow.nome_casino,
      funnel: payload.funnelType,
      tier: payload.tier,
      chunks: chunks.length,
      templateDaysFound: payload.funnelType === "Sazonal" ? [] : extractTemplateDays(templateFull),
      daysBriefed: sazonalActive ? "sazonal" : days.filter((d) => d.active).map((d) => d.day),
    });

    const rewrittenChunks: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const templateChunk = chunks[i];
      const isDayChunk = /^(?:🔹|🔸)?\s*DIA\s*\d+/i.test(templateChunk);
      const dayNumber = isDayChunk ? dayNumberFromChunk(templateChunk) : null;

      const dayBrief =
        !sazonalActive && dayNumber && (briefingByDay as any)?.byDay?.[dayNumber]
          ? (briefingByDay as any).byDay[dayNumber]
          : "";

      const rewritePrompt = [
        "Você é um redator CRM sênior.",
        "Escreva APENAS em Português do Brasil (PT-BR) nativo.",
        "Aplique fortemente os princípios e fundamentos do GUIA MESTRE, com foco na linguagem Las Vegas.",
        "NÃO use linguagem vulgar.",
        "NÃO inclua diagnóstico, explicações, metacomunicação ou textos fora do molde.",
        "Tarefa: REESCREVER o TEMPLATE abaixo mantendo o MODELO/FORMATO do molde.",
        "",
        "REGRAS DE QUALIDADE (obrigatórias):",
        "- EVITE REPETIÇÃO: não repita a mesma palavra-âncora (ex: 'forra') muitas vezes.",
        "- Regra prática: use no máximo 1 ocorrência de 'forra' por peça (por Email/Push/SMS/Popup) e varie com sinônimos naturais quando precisar.",
        "- Sinônimos/alternativas possíveis (use conforme contexto): 'o doce', 'o lucro', 'sacar', 'bater a meta', 'pegar o prêmio', 'rodar forte', 'entrar no jogo', 'fazer render'.",
        "- Se a referência/template usar uma palavra repetida como parte do FORMATO/assinatura do cassino, mantenha; caso contrário, varie.",
        "",
        "REGRAS DE FORMATO (obrigatórias):",
        "- Preserve a estrutura: headers, labels (ex: 'Assunto:', 'Corpo:'), ordem das seções e separadores.",
        "- Você pode ajustar/remover/adicionar LINHAS DENTRO de uma seção para refletir o BRIEFING (ex: lista de ofertas/valores e CTAs), mas NÃO crie seções novas.",
        "- Não mude nomes de seções (ex: 'Assunto:', 'Corpo:', 'SMS', 'Push', etc.).",
        "",
        "REGRAS DE CONTEÚDO (críticas):",
        "- Trate qualquer valor/benefício/CTA do TEMPLATE como EXEMPLO, e substitua pelos inputs do BRIEFING.",
        "- NUNCA invente ofertas, valores, bônus, prazos ou CTAs que não estejam no briefing do dia.",
        "- Se o briefing trouxer 1 CTA/oferta, a saída deve ter SOMENTE 1 CTA/oferta (não mantenha 3 opções do template).",
        "- Termos e Condições DEVEM estar coerentes com a oferta do BRIEFING:",
        "  - Se o briefing NÃO especifica valores/regras (ex: depósitos e requisitos), NÃO cite números/valores.",
        "  - Se o briefing especifica valores/condições, mencione SOMENTE os que existirem no briefing (não carregue valores do template).",
        "  - Se o template tiver uma lista de T&C com múltiplos valores e o briefing tiver apenas 1 oferta, remova as linhas conflitantes e mantenha apenas o que for compatível.",
        "",
        isDayChunk
          ? "- Este chunk é um DIA do funil: mantenha exatamente esse DIA e toda a estrutura interna."
          : "- Este chunk é o preâmbulo (popups + header): mantenha exatamente a estrutura.",
        "",
        `CASINO: ${casinoRow.nome_casino}`,
        `TOM_DE_VOZ: ${casinoTone}`,
        `TIER: ${payload.tier}`,
        `FUNIL: ${payload.funnelType}${payload.reativacaoRegua ? ` (${payload.reativacaoRegua})` : ""}`,
        "",
        "GUIA MESTRE:",
        masterPrompt,
        "",
        "INSTRUÇÕES DO CASINO:",
        casinoInstruction,
        "",
        isDayChunk
          ? [
              "BRIEFING DO DIA (inputs do operador para este dia):",
              dayBrief || "(vazio) — se estiver vazio, reescreva de forma neutra SEM inventar valores novos.",
            ].join("\n")
          : [
              "BRIEFING (contexto geral do operador):",
              (days.find((d) => d.active)
                ? (briefingByDay as any).byDay[(days.find((d) => d.active) as any).day]
                : "") || "(vazio)",
            ].join("\n"),
        "",
        "TEMPLATE PARA REESCREVER:",
        templateChunk,
        "",
        "SAÍDA: Retorne SOMENTE o texto reescrito deste TEMPLATE, sem comentários.",
      ].join("\n");

      const gen = await callGeminiFlash(rewritePrompt, {
        maxOutputTokens: 8192,
        temperature: 0.35,
      });

      if (!gen.ok) {
        console.error("[generate-copy] Chunk generation failed", { i, error: gen.error });
        return new Response(
          JSON.stringify({
            error: `Falha ao gerar (chunk ${i + 1}/${chunks.length}).`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let out = stripMetaOnly(gen.text);

      // Correção de segurança: o modelo às vezes devolve o chunk sem o cabeçalho "🔹 DIA N".
      // Forçamos a primeira linha do template no output para não "sumir" dia.
      if (isDayChunk) {
        const headerLine = (templateChunk.split("\n")[0] ?? "").trim();
        if (headerLine && !out.trimStart().startsWith(headerLine)) {
          out = [headerLine, out].filter(Boolean).join("\n").trim();
        }
      }

      rewrittenChunks.push(out);
    }

    const finalText = rewrittenChunks.join("\n\n").trim();

    return new Response(JSON.stringify({ copyAll: finalText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[generate-copy] Unhandled error", { error });
    return new Response(JSON.stringify({ error: "Erro inesperado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});