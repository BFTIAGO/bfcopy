import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  const parsed = Array.from({ length: 5 }).map((_, i) => {
    const d = days[i] ?? ({} as any);
    const gameName = (d.gameName ?? "").trim();
    const freeMessage = (d.freeMessage ?? "").trim();
    const buttons = (d.buttons ?? [])
      .map((b: any) => (b.text ?? "").trim())
      .filter(Boolean);

    const active = gameName.length > 0 || freeMessage.length > 0 || buttons.length > 0;

    return {
      day: i + 1,
      type:
        d.mode === "A" ? "Deposite, jogue e ganhe" : "Outro tipo de oferta",
      gameName,
      buttons,
      freeMessage,
      active,
    };
  });

  // Para garantir funil completo de 5 dias:
  // se um dia estiver vazio, ele herda a oferta do último dia preenchido (fallback para Dia 1).
  let lastActiveIndex = parsed.findIndex((d) => d.active);
  if (lastActiveIndex === -1) {
    // sem nenhum dia preenchido — o front deveria bloquear, mas mantemos seguro
    return parsed.map((d) => ({ ...d, repeatOfDay: 1 }));
  }

  const out: Array<{
    day: number;
    type: string;
    gameName: string;
    buttons: string[];
    freeMessage: string;
    repeatOfDay?: number;
  }> = [];

  let lastFilled = parsed[lastActiveIndex];
  let lastFilledDay = parsed[lastActiveIndex].day;

  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i];
    if (cur.active) {
      out.push({
        day: cur.day,
        type: cur.type,
        gameName: cur.gameName,
        buttons: cur.buttons,
        freeMessage: cur.freeMessage,
      });
      lastFilled = cur;
      lastFilledDay = cur.day;
      continue;
    }

    // dia vazio -> repete último preenchido (ou dia 1 se nenhum anterior)
    const fallback = i === 0 ? parsed[0] : lastFilled;
    const fallbackDay = i === 0 ? 1 : lastFilledDay;

    out.push({
      day: cur.day,
      type: fallback.type,
      gameName: fallback.gameName,
      buttons: fallback.buttons,
      freeMessage: fallback.freeMessage,
      repeatOfDay: fallbackDay,
    });
  }

  return out;
}

function hasFiveDays(text: string) {
  const t = (text ?? "").toLowerCase();
  return [1, 2, 3, 4, 5].every((n) => new RegExp(`\\bdia\\s*${n}\\b`, "i").test(t));
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

function truncateAfterDay5(v: string) {
  const s = v ?? "";
  const m = s.match(/\bDIA\s*6\b/i);
  if (!m || m.index == null) return s;
  // corta no início da linha onde começa DIA 6
  const idx = m.index;
  const lineStart = s.lastIndexOf("\n", idx);
  return s.slice(0, lineStart >= 0 ? lineStart : idx).trim();
}

async function callGeminiFlash(prompt: string) {
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
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 16384,
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

function stripEmojisAndMeta(v: string) {
  let out = v ?? "";
  // Remove linhas de meta comuns
  out = out
    .split("\n")
    .filter((line) => {
      const l = line.trim().toLowerCase();
      if (l.startsWith("diagnóstico:")) return false;
      if (l.startsWith("diagnostico:")) return false;
      if (l.startsWith("copy final:")) return false;
      if (l.startsWith("copy final")) return false;
      return true;
    })
    .join("\n");

  // Remove emojis / pictogramas
  try {
    out = out.replace(/[\p{Extended_Pictographic}]/gu, "");
  } catch {
    // fallback simples
    out = out.replace(/[\u2190-\u21FF\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF]+/g, "");
  }

  // Limpa espaços duplicados
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    const basePrompt = [
      "Você é um redator CRM sênior.",
      "Escreva APENAS em Português do Brasil (PT-BR) nativo.",
      "NÃO use linguagem vulgar.",
      "NÃO inclua diagnóstico, explicações, metacomunicação ou títulos do tipo 'Diagnóstico'/'Copy Final'.",
      "A saída DEVE seguir fielmente o mesmo MODELO das referências (mesmas seções, labels, ordem, separadores e estilo).",
      "Mantenha o mesmo padrão de EMOJIS do molde (se a referência usa emojis em títulos/labels, use os MESMOS; não invente emojis novos).",
      "Não copie frases literalmente: reescreva mantendo a estrutura.",
      "Respeite o guia mestre e o tom de voz do cassino.",
      "Evite inventar valores específicos se não foram fornecidos.",
      "Garanta que o texto fique completo (não pare no meio de uma frase/linha).",
      "Se este for um funil de 5 dias, entregue obrigatoriamente DIA 1, DIA 2, DIA 3, DIA 4 e DIA 5 (não inclua DIA 6+).",
      "",
      `CASINO: ${casinoRow.nome_casino}`,
      `TOM_DE_VOZ: ${casinoTone}`,
      `TIER: ${payload.tier}`,
      `FUNIL: ${payload.funnelType}${payload.reativacaoRegua ? ` (${payload.reativacaoRegua})` : ""}`,
      "",
      "GUIA MESTRE (obrigatório):",
      masterPrompt,
      "",
      "INSTRUÇÕES DO CASINO:",
      casinoInstruction,
      "",
      "REFERÊNCIA (use como TEMPLATE; mantenha a estrutura 1:1 e apenas substitua os trechos variáveis conforme entradas):",
      references.join("\n\n---\n\n"),
      "",
      "ENTRADAS DO OPERADOR:",
      sazonalActive
        ? [
            `JOGO: ${(sazonal.gameName ?? "").trim()}`,
            `OFERTA: ${(sazonal.offerDescription ?? "").trim()}`,
            (sazonal.includeUpsellDownsell
              ? `UPSELL: ${(sazonal.upsell ?? "").trim()}\nDOWNSELL: ${(sazonal.downsell ?? "").trim()}`
              : ""),
          ]
            .filter(Boolean)
            .join("\n")
        : days
            .map((d) => {
              const parts = [
                `DIA ${d.day}`,
                d.repeatOfDay ? `REPETIR_OFERTA_DO_DIA: ${d.repeatOfDay}` : "",
                `TIPO: ${d.type}`,
                d.gameName ? `JOGO: ${d.gameName}` : "",
                d.buttons?.length ? `BOTÕES/CTAs: ${d.buttons.join(" | ")}` : "",
                d.freeMessage ? `MENSAGEM_BASE: ${d.freeMessage}` : "",
              ].filter(Boolean);
              return parts.join("\n");
            })
            .join("\n\n"),
      "",
      "SAÍDA:",
      "Retorne SOMENTE a copy final no formato da referência, sem nenhum texto fora do molde.",
    ].join("\n");

    console.log("[generate-copy] Generating", {
      casino: payload.casino,
      funnel: payload.funnelType,
      tier: payload.tier,
      refsUsed: refKeys,
      days: sazonalActive ? "sazonal" : days.map((d) => d.day),
    });

    // 1) Geração
    const gen1 = await callGeminiFlash(basePrompt);
    if (!gen1.ok) {
      return new Response(JSON.stringify({ error: gen1.error }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Revisão para forçar aderência ao molde (reduz deriva e truncamentos)
    const reviewPrompt = [
      "Você é um revisor de copy CRM extremamente rígido.",
      "Objetivo: ajustar o texto para ficar 100% aderente ao MODELO/FORMATO da REFERÊNCIA.",
      "Regras:",
      "- PT-BR nativo.",
      "- Não use linguagem vulgar.",
      "- Não escreva diagnósticos, comentários ou explicações.",
      "- Preserve exatamente a estrutura da referência: mesmas seções, mesma ordem, mesmos labels, separadores e padrão de emojis.",
      "- Se algo estiver faltando, complete.",
      "- Para funil de 5 dias, garantir DIA 1..DIA 5 (não incluir DIA 6+).",
      "- Entregue SOMENTE a copy final.",
      "",
      "REFERÊNCIA:",
      references.join("\n\n---\n\n"),
      "",
      "RASCUNHO:",
      gen1.text,
    ].join("\n");

    const gen2 = await callGeminiFlash(reviewPrompt);
    let finalText = stripMetaOnly((gen2.ok ? gen2.text : gen1.text) ?? "");
    finalText = truncateAfterDay5(finalText);

    // 3) Se ainda não vier 5 dias, pedir complemento (sem alterar o que já está certo)
    if (!sazonalActive && !hasFiveDays(finalText)) {
      console.warn("[generate-copy] Missing days in output, requesting completion", {
        casino: payload.casino,
        funnel: payload.funnelType,
      });
      const completionPrompt = [
        "Você é um revisor de copy CRM extremamente rígido.",
        "O texto abaixo está INCOMPLETO (faltam dias do funil).",
        "Tarefa: entregar o funil COMPLETO de 5 dias (DIA 1..DIA 5) no exato molde da referência.",
        "Regras:",
        "- Não use linguagem vulgar.",
        "- Preserve o padrão de emojis e headers da referência (não invente novos).",
        "- Não escreva diagnósticos nem comentários.",
        "- Preserve o que já está bom e complete o que falta.",
        "- NÃO inclua DIA 6+.",
        "- Entregue SOMENTE a copy final.",
        "",
        "REFERÊNCIA:",
        references.join("\n\n---\n\n"),
        "",
        "TEXTO ATUAL:",
        finalText,
        "",
        "ENTRADAS DO OPERADOR (5 dias):",
        days
          .map((d) => {
            const parts = [
              `DIA ${d.day}`,
              d.repeatOfDay ? `REPETIR_OFERTA_DO_DIA: ${d.repeatOfDay}` : "",
              `TIPO: ${d.type}`,
              d.gameName ? `JOGO: ${d.gameName}` : "",
              d.buttons?.length ? `BOTÕES/CTAs: ${d.buttons.join(" | ")}` : "",
              d.freeMessage ? `MENSAGEM_BASE: ${d.freeMessage}` : "",
            ].filter(Boolean);
            return parts.join("\n");
          })
          .join("\n\n"),
      ].join("\n");

      const gen3 = await callGeminiFlash(completionPrompt);
      if (gen3.ok) {
        finalText = stripMetaOnly(gen3.text);
        finalText = truncateAfterDay5(finalText);
      }
    }

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