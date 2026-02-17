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
    // Como o front agrupa, usamos as duas referências quando existirem.
    return ["ref_ativacao_std", "ref_ativacao_ttd_4td"];
  }

  // Reativação
  const r = (payload.reativacaoRegua ?? "").trim().toUpperCase();
  if (r === "7D") return ["ref_reativacao_7d"];
  if (r === "15D") return ["ref_reativacao_14d"];
  if (r === "21D") return ["ref_reativacao_21d"];
  if (r === "30D") return ["ref_reativacao_30d"];
  if (["40D", "50D", "60D"].includes(r)) return ["ref_reativacao_40d_60d"];
  if ([
    "70D",
    "80D",
    "90D",
    "120D",
    "150D",
    "180D",
  ].includes(r)) {
    return ["ref_reativacao_70d_180d"];
  }

  // Sem FTD (ou qualquer outro): melhor aproximação
  return ["ref_reativacao_7d"];
}

function normalizeDays(payload: Payload) {
  const days = payload.days ?? [];
  return days
    .map((d, i) => {
      const gameName = (d.gameName ?? "").trim();
      const freeMessage = (d.freeMessage ?? "").trim();
      const buttons = (d.buttons ?? [])
        .map((b) => (b.text ?? "").trim())
        .filter(Boolean);
      const active = gameName.length > 0 || freeMessage.length > 0 || buttons.length > 0;
      if (!active) return null;

      return {
        day: i + 1,
        type:
          d.mode === "A"
            ? "Deposite, jogue e ganhe"
            : "Outro tipo de oferta",
        gameName,
        buttons,
        freeMessage,
      };
    })
    .filter(Boolean) as Array<{
    day: number;
    type: string;
    gameName: string;
    buttons: string[];
    freeMessage: string;
  }>;
}

async function callGeminiFlash(prompt: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[generate-copy] Missing GEMINI_API_KEY secret");
    return { ok: false, error: "GEMINI_API_KEY não configurada." } as const;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        topP: 0.9,
        maxOutputTokens: 2048,
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

    const { data: casinoRow, error: casinoErr } = await supabase
      .from("casino_prompts")
      .select(
        [
          "nome_casino",
          "tom_voz",
          "prompt_instrucao",
          "ref_ativacao_ftd",
          "ref_ativacao_std",
          "ref_ativacao_ttd_4td",
          "ref_ativacao_5td_7td",
          "ref_ativacao_8td_10td_plus",
          "ref_reativacao_7d",
          "ref_reativacao_14d",
          "ref_reativacao_21d",
          "ref_reativacao_30d",
          "ref_reativacao_40d_60d",
          "ref_reativacao_70d_180d",
          "ref_sazonal",
        ].join(","),
      )
      .eq("nome_casino", payload.casino)
      .maybeSingle();

    if (casinoErr || !casinoRow) {
      console.error("[generate-copy] casino_prompts missing", { casinoErr, casino: payload.casino });
      return new Response(JSON.stringify({ error: "Casino não encontrado em casino_prompts." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const refKeys = pickRefKey(payload);
    const references = refKeys
      .map((k) => (casinoRow as any)?.[k])
      .filter((v) => typeof v === "string" && v.trim().length > 0)
      .map((v) => String(v).trim());

    if (references.length === 0) {
      console.warn("[generate-copy] Missing references for funnel", {
        casino: payload.casino,
        funnel: payload.funnelType,
        reativacaoRegua: payload.reativacaoRegua,
        refKeys,
      });
      return new Response(
        JSON.stringify({
          error:
            "Não é possível gerar: falta referência cadastrada para esse cassino/funil (casino_prompts.ref_*).",
          missingRefKeys: refKeys,
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

    const prompt = [
      "Você é um redator CRM sênior. Escreva APENAS em Português do Brasil (PT-BR) nativo.",
      "Não use inglês. Não explique. Não cite políticas. Não inclua comentários.",
      "Siga o TOM DE VOZ do cassino e imite o FORMATO das referências fornecidas (estrutura/headers, estilo e densidade), mas sem copiar frases literalmente.",
      "Evite promessas impossíveis e evite inventar valores específicos se não foram fornecidos. Se faltar um detalhe, escreva de forma genérica e segura.",
      "",
      `CASINO: ${casinoRow.nome_casino}`,
      `TOM_DE_VOZ: ${casinoRow.tom_voz}`,
      `TIER: ${payload.tier}`,
      `FUNIL: ${payload.funnelType}${payload.reativacaoRegua ? ` (RÉGUA ${payload.reativacaoRegua})` : ""}`,
      "",
      "INSTRUÇÕES MASTER:",
      (master?.prompt_instrucao ?? "").trim(),
      "",
      "INSTRUÇÕES DO CASINO:",
      String(casinoRow.prompt_instrucao ?? "").trim(),
      "",
      "REFERÊNCIAS DE FORMATO (use como espelho de estrutura; não copie texto):",
      references.length ? references.join("\n\n---\n\n") : "(sem referências cadastradas para este funil)",
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
                `DIA ${d.day} — TIPO: ${d.type}`,
                d.gameName ? `JOGO: ${d.gameName}` : "",
                d.buttons?.length ? `BOTÕES/CTAs: ${d.buttons.join(" | ")}` : "",
                d.freeMessage ? `MENSAGEM_BASE: ${d.freeMessage}` : "",
              ].filter(Boolean);
              return parts.join("\n");
            })
            .join("\n\n"),
      "",
      "SAÍDA (obrigatório):",
      sazonalActive
        ? [
            "CAMPANHA SAZONAL",
            "EMAIL",
            "ASSUNTO:",
            "PREHEADER:",
            "CORPO:",
            "",
            "PUSH:",
            "",
            "SMS:",
            "",
            "POPUP:",
          ].join("\n")
        : [
            "DIA 1",
            "EMAIL",
            "ASSUNTO:",
            "PREHEADER:",
            "CORPO:",
            "",
            "PUSH:",
            "",
            "SMS:",
            "",
            "POPUP:",
            "",
            "DIA 2",
            "(repita o mesmo bloco até DIA 5 apenas para os dias que foram preenchidos)",
          ].join("\n"),
    ].join("\n");

    console.log("[generate-copy] Generating", {
      casino: payload.casino,
      funnel: payload.funnelType,
      tier: payload.tier,
      refsUsed: refKeys,
      days: sazonalActive ? "sazonal" : days.map((d) => d.day),
    });

    const gen = await callGeminiFlash(prompt);
    if (!gen.ok) {
      return new Response(JSON.stringify({ error: gen.error }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ copyAll: gen.text }), {
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