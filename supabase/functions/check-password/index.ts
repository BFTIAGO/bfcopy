import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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
    const expected = Deno.env.get("BETFUNNELS_APP_PASSWORD") ?? "";
    if (!expected) {
      console.error("[check-password] Missing BETFUNNELS_APP_PASSWORD secret");
      return new Response(JSON.stringify({ error: "Senha não configurada." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const password = String(body?.password ?? "");

    if (password !== expected) {
      console.warn("[check-password] Invalid password attempt");
      return new Response(JSON.stringify({ error: "Senha inválida." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[check-password] Unhandled error", { error });
    return new Response(JSON.stringify({ error: "Erro inesperado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
