import React, { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";

type Props = {
  onUnlocked: (password: string) => void;
};

export function AccessGate({ onUnlocked }: Props) {
  const [password, setPassword] = useState("");
  const canSubmit = useMemo(() => password.trim().length >= 3, [password]);

  async function handleUnlock() {
    const toastId = showLoading("Verificando senha…");
    try {
      const { data, error } = await supabase.functions.invoke("check-password", {
        body: { password },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Senha inválida.");

      showSuccess("Acesso liberado.");
      onUnlocked(password);
    } catch (e: any) {
      const errMsg = e?.message || "Senha inválida.";
      showError(errMsg);
    } finally {
      dismissToast(toastId);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-10">
        <Card className="w-full rounded-3xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <span className="grid h-9 w-9 place-items-center rounded-2xl bg-indigo-50 text-indigo-700">
                <Lock className="h-4 w-4" />
              </span>
              Acesso restrito
            </CardTitle>
            <p className="text-sm text-slate-600">
              Digite a senha do app para continuar.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="rounded-3xl border-slate-200 bg-slate-50">
              <AlertTitle className="text-sm font-semibold text-slate-900">
                Segurança
              </AlertTitle>
              <AlertDescription className="text-sm text-slate-600">
                Isso é uma barreira simples para evitar acesso público por link.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Senha</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-2xl border-slate-200"
                placeholder="Digite a senha"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) handleUnlock();
                }}
              />
            </div>

            <Button
              onClick={handleUnlock}
              disabled={!canSubmit}
              className="h-11 w-full rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700"
            >
              ENTRAR
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
