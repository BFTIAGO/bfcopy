import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-password",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Gate simples por senha (mesma do app)
    const expectedPassword = Deno.env.get("BETFUNNELS_APP_PASSWORD") ?? "";
    if (!expectedPassword) {
      console.error("[search-casinos] Missing BETFUNNELS_APP_PASSWORD secret");
      return new Response(JSON.stringify({ error: "Senha não configurada." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const providedPassword = req.headers.get("x-app-password") ?? "";
    if (providedPassword !== expectedPassword) {
      console.warn("[search-casinos] Invalid password attempt");
      return new Response(JSON.stringify({ error: "Não autorizado." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[search-casinos] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(JSON.stringify({ error: "Configuração do servidor ausente." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = (await req.json().catch(() => ({}))) as { query?: string };
    const query = String(body?.query ?? "").trim();

    if (!query) {
      return new Response(JSON.stringify({ options: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase
      .from("casino_prompts")
      .select("nome_casino")
      .ilike("nome_casino", `%${query}%`)
      .order("nome_casino", { ascending: true })
      .limit(12);

    if (error) {
      console.error("[search-casinos] Query error", { error });
      return new Response(JSON.stringify({ error: "Falha ao buscar cassinos." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const options = (data ?? [])
      .map((r: any) => String(r?.nome_casino ?? "").trim())
      .filter(Boolean);

    return new Response(JSON.stringify({ options }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[search-casinos] Unhandled error", { error });
    return new Response(JSON.stringify({ error: "Erro inesperado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
