import React, { useMemo, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { AccessGate } from "@/components/AccessGate";
import { CasinoCombobox } from "@/components/CasinoCombobox";

import { showError, showLoading, showSuccess, dismissToast } from "@/utils/toast";
import { supabase } from "@/integrations/supabase/client";

const funnelTypes = [
  "Ativação FTD",
  "Ativação STD / TTD / 4TD+",
  "Reativação",
  "Sazonal",
] as const;

const reativacaoReguas = ["Sem FTD", "Sem Depósito", "Sem Login"] as const;

const tiers = ["Tier 1", "Tier 2", "Tier 3"] as const;

const daySchema = z
  .object({
    mode: z.enum(["A", "B"]).default("A"),
    gameName: z.string().optional(),
    buttonCount: z.number().int().min(1).max(5).default(3),
    buttons: z.array(z.object({ text: z.string().optional() })).default([]),
    freeMessage: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === "A") {
      if (!d.gameName || d.gameName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gameName"],
          message: "Nome do jogo é obrigatório em 'Deposite, jogue e ganhe'.",
        });
      }
      const expected = d.buttonCount ?? 0;
      for (let i = 0; i < expected; i++) {
        const t = d.buttons?.[i]?.text ?? "";
        if (t.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["buttons", i, "text"],
            message: `Preencha o texto do Botão ${i + 1}.`,
          });
        }
      }
    } else {
      if (!d.freeMessage || d.freeMessage.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["freeMessage"],
          message: "Mensagem do dia é obrigatória em 'Outro tipo de oferta'.",
        });
      }
    }
  });

const formSchema = z
  .object({
    casino: z.string().min(1, "Informe o nome do cassino."),
    funnelType: z.enum(funnelTypes),
    reativacaoRegua: z.enum(reativacaoReguas).optional(),
    tier: z.enum(tiers),

    days: z
      .array(daySchema)
      .length(6)
      .default([
        { mode: "A", buttonCount: 3, buttons: [{}, {}, {}] },
        { mode: "A", buttonCount: 3, buttons: [{}, {}, {}] },
        { mode: "A", buttonCount: 3, buttons: [{}, {}, {}] },
        { mode: "A", buttonCount: 3, buttons: [{}, {}, {}] },
        { mode: "A", buttonCount: 3, buttons: [{}, {}, {}] },
        { mode: "A", buttonCount: 3, buttons: [{}, {}, {}] },
      ]),

    sazonal: z
      .object({
        gameName: z.string().optional(),
        offerDescription: z.string().optional(),
        includeUpsellDownsell: z.boolean().default(false),
        upsell: z.string().optional(),
        downsell: z.string().optional(),
      })
      .default({ includeUpsellDownsell: false }),
  })
  .superRefine((data, ctx) => {
    if (data.funnelType === "Reativação" && !data.reativacaoRegua) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reativacaoRegua"],
        message: "Selecione a régua de Reativação.",
      });
    }

    if (data.funnelType === "Sazonal") {
      if (!data.sazonal.gameName || data.sazonal.gameName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sazonal", "gameName"],
          message: "Nome do jogo é obrigatório na Sazonal.",
        });
      }
      if (
        !data.sazonal.offerDescription ||
        data.sazonal.offerDescription.trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sazonal", "offerDescription"],
          message: "Descrição da oferta é obrigatória na Sazonal.",
        });
      }
      if (data.sazonal.includeUpsellDownsell) {
        const upsellOk = (data.sazonal.upsell ?? "").trim().length > 0;
        const downsellOk = (data.sazonal.downsell ?? "").trim().length > 0;
        if (!upsellOk && !downsellOk) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sazonal", "includeUpsellDownsell"],
            message: "Se marcar Upsell/Downsell, preencha pelo menos um deles.",
          });
        }
      }
    } else {
      const anyTouched = data.days.some((d) => {
        const game = (d.gameName ?? "").trim();
        const free = (d.freeMessage ?? "").trim();
        const anyBtn = (d.buttons ?? []).some((b) => (b.text ?? "").trim().length > 0);
        return game.length > 0 || free.length > 0 || anyBtn;
      });
      if (!anyTouched) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days"],
          message:
            "Preencha pelo menos 1 dia (Deposite, jogue e ganhe / Outro tipo de oferta) antes de gerar.",
        });
      }

      const isFtdOrSemFtd =
        data.funnelType === "Ativação FTD" ||
        (data.funnelType === "Reativação" && data.reativacaoRegua === "Sem FTD");

      if (isFtdOrSemFtd) {
        const forbidden = /deposit/i; // deposite/depositar/depósito

        data.days.forEach((d, dayIndex) => {
          const btns = d.buttons ?? [];
          btns.forEach((b, i) => {
            const t = (b.text ?? "").trim();
            if (t && forbidden.test(t)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["days", dayIndex, "buttons", i, "text"],
                message:
                  "Palavra proibida em FTD/SEM FTD. Tente: \"Coloca…\", \"Começa com…\", \"Banca…\", \"Jogue R$…\"",
              });
            }
          });

          const free = (d.freeMessage ?? "").trim();
          if (free && forbidden.test(free)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["days", dayIndex, "freeMessage"],
              message:
                "Palavra proibida em FTD/SEM FTD. Tente: \"Coloca…\", \"Começa com…\", \"Banca…\", \"Jogue R$…\"",
            });
          }
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

type SmarticoOutput = {
  funnel: string;
  casino: string;
  tier: string;
  reativacaoRegua?: string;
  copyAll?: string;
  // Depois o backend vai devolver as peças. Mantemos flexível.
  piecesByDay?: Array<{
    day: number;
    email?: string;
    push?: string;
    sms?: string;
    popup?: string;
  }>;
  sazonal?: {
    email?: string;
    push?: string;
    sms?: string;
    popup?: string;
  };
};

function ensureButtonsLen(buttons: Array<{ text?: string }>, n: number) {
  const next = [...buttons];
  while (next.length < n) next.push({});
  return next.slice(0, n);
}

function dayHasContent(d: {
  gameName?: string;
  freeMessage?: string;
  buttons?: Array<{ text?: string }>;
}) {
  const game = (d.gameName ?? "").trim();
  const free = (d.freeMessage ?? "").trim();
  const anyBtn = (d.buttons ?? []).some((b) => (b.text ?? "").trim().length > 0);
  return game.length > 0 || free.length > 0 || anyBtn;
}

const Index = () => {
  const [activeView, setActiveView] = useState<"form" | "output">("form");
  const [lastPayload, setLastPayload] = useState<FormValues | null>(null);
  const [output, setOutput] = useState<SmarticoOutput | null>(null);
  const [repeatSourceByDay, setRepeatSourceByDay] = useState<Record<number, number>>({});
  const [appPassword, setAppPassword] = useState<string>(() => {
    try {
      return localStorage.getItem("betfunnels_app_password") ?? "";
    } catch {
      return "";
    }
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      casino: "",
      funnelType: "Ativação FTD",
      tier: "Tier 1",
      days: [
        { mode: "A", gameName: "", buttonCount: 3, buttons: [{}, {}, {}], freeMessage: "" },
        { mode: "A", gameName: "", buttonCount: 3, buttons: [{}, {}, {}], freeMessage: "" },
        { mode: "A", gameName: "", buttonCount: 3, buttons: [{}, {}, {}], freeMessage: "" },
        { mode: "A", gameName: "", buttonCount: 3, buttons: [{}, {}, {}], freeMessage: "" },
        { mode: "A", gameName: "", buttonCount: 3, buttons: [{}, {}, {}], freeMessage: "" },
        { mode: "A", gameName: "", buttonCount: 3, buttons: [{}, {}, {}], freeMessage: "" },
      ],
      sazonal: {
        gameName: "",
        offerDescription: "",
        includeUpsellDownsell: false,
        upsell: "",
        downsell: "",
      },
    },
    mode: "onChange",
  });

  const daysArray = useFieldArray({ control: form.control, name: "days" });

  const funnelType = form.watch("funnelType");
  const reativacaoRegua = form.watch("reativacaoRegua");
  const includeUD = form.watch("sazonal.includeUpsellDownsell");

  const isFtdOrSemFtd =
    funnelType === "Ativação FTD" ||
    (funnelType === "Reativação" && reativacaoRegua === "Sem FTD");

  const offerExamplePlaceholder = isFtdOrSemFtd
    ? "Ex: Jogue R$50 e ganhe 10 Giros Extras"
    : "Ex: Deposite R$50, jogue R$50 e ganhe 10 Giros Extras";

  const headlineTitle = "Betfunnels Copy";

  async function handleGenerate(values: FormValues) {
    setLastPayload(values);

    const toastId = showLoading("Gerando copy…");
    try {
      const { data, error } = await supabase.functions.invoke("generate-copy", {
        body: values,
        headers: {
          "x-app-password": appPassword,
        },
      });

      if (error) throw error;

      setOutput({
        funnel: values.funnelType,
        casino: values.casino,
        tier: values.tier,
        reativacaoRegua: values.reativacaoRegua,
        copyAll: data?.copyAll ?? "",
      });
      setActiveView("output");
      showSuccess("Copy gerada.");
    } catch (e: any) {
      // Supabase functions retornam detalhes no Response (context)
      let errMsg =
        e?.context?.error_description || e?.context?.error || e?.message || "Falha ao gerar.";
      try {
        if (e?.context && typeof e.context.text === "function") {
          const raw = await e.context.text();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              errMsg = parsed?.error || parsed?.message || raw;
              if (parsed?.missingRefKeys?.length) {
                errMsg = `${errMsg} (faltando: ${parsed.missingRefKeys.join(", ")})`;
              }
              if (parsed?.missingDays?.length) {
                errMsg = `${errMsg}\nFaltando dias no template: ${parsed.missingDays.join(", ")}`;
              }
              if (parsed?.foundDays?.length) {
                errMsg = `${errMsg}\nDias encontrados: ${parsed.foundDays.join(", ")}`;
              }
              if (parsed?.casino) {
                errMsg = `${errMsg} (selecionado: ${parsed.casino})`;
              }
              if (parsed?.availableCasinos?.length) {
                const list = parsed.availableCasinos.slice(0, 12).join(", ");
                errMsg = `${errMsg}\nDisponíveis: ${list}${parsed.availableCasinos.length > 12 ? "…" : ""}`;
              }
              if (parsed?.matchedCasino) {
                errMsg = `${errMsg}\nCasado no banco: ${parsed.matchedCasino}`;
              }
              if (parsed?.refDebug) {
                const lines = Object.entries(parsed.refDebug)
                  .map(([k, v]: any) => `${k}: trimmed=${v.trimmedLength}`)
                  .join(" | ");
                errMsg = `${errMsg}\nRefs: ${lines}`;
              }
            } catch {
              errMsg = raw;
            }
          }
        }
      } catch {
        // ignore
      }
      showError(errMsg);
    } finally {
      dismissToast(toastId);
    }
  }

  // Gate simples de acesso
  if (!appPassword) {
    return (
      <AccessGate
        onUnlocked={(pwd) => {
          setAppPassword(pwd);
          try {
            localStorage.setItem("betfunnels_app_password", pwd);
          } catch {
            // ignore
          }
        }}
      />
    );
  }

  function copyToClipboard(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => showSuccess("Copiado!") )
      .catch(() => showError("Não foi possível copiar."));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-600">
              Interno
            </Badge>
            <Badge
              variant="secondary"
              className="rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-50"
            >
              Smartico.ai
            </Badge>
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {headlineTitle}
          </h1>
        </div>

        {activeView === "form" ? (
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-8 pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleGenerate)} className="space-y-8">
                  {/* BLOCO 1 */}
                  <section className="space-y-3">
                    <FormField
                      control={form.control}
                      name="casino"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700">Informe o nome do cassino</FormLabel>
                          <FormControl>
                            <CasinoCombobox
                              value={(field.value || undefined) as any}
                              onChange={(v) => field.onChange(v ?? "")}
                              onSearch={async (q) => {
                                const { data, error } = await supabase.functions.invoke(
                                  "search-casinos",
                                  {
                                    body: { query: q },
                                    headers: { "x-app-password": appPassword },
                                  },
                                );
                                if (error) throw error;
                                return (data?.options ?? []) as string[];
                              }}
                              placeholder="Informe o nome do cassino…"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </section>

                  <Separator className="bg-slate-100" />

                  {/* BLOCO 2 */}
                  <section className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="funnelType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700">Tipo de funil</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={(v) => {
                                field.onChange(v);
                                if (v !== "Reativação") form.setValue("reativacaoRegua", undefined);
                              }}
                            >
                              <FormControl>
                                <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white">
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="rounded-2xl">
                                {funnelTypes.map((f) => (
                                  <SelectItem key={f} value={f}>
                                    {f}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="tier"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700">Tier do jogador</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white">
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="rounded-2xl">
                                {tiers.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {(funnelType === "Ativação FTD" ||
                      (funnelType === "Reativação" && reativacaoRegua === "Sem FTD")) && (
                      <Alert className="rounded-3xl border-amber-200 bg-amber-50 text-amber-950">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm font-semibold">
                          ATENÇÃO: FUNIL FTD e SEM FTD
                        </AlertTitle>
                        <AlertDescription className="text-sm text-amber-900">
                          NÃO use "deposite" nas ofertas. Use: "Coloca", "Começa com", "Banca".
                        </AlertDescription>
                      </Alert>
                    )}

                    {funnelType === "Reativação" && (
                      <FormField
                        control={form.control}
                        name="reativacaoRegua"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700">Régua de reativação</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white">
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="rounded-2xl">
                                {reativacaoReguas.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </section>

                  <Separator className="bg-slate-100" />

                  {/* BLOCO 3 */}
                  {funnelType === "Sazonal" ? (
                    <section className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">Oferta Sazonal</h2>
                        <p className="text-sm text-slate-600">1 dia (oferta única por envio)</p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="sazonal.gameName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-slate-700">Nome do jogo</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  className="h-11 rounded-2xl border-slate-200"
                                  placeholder='Ex: "Tigre Sortudo"'
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="hidden md:block" />
                      </div>

                      <FormField
                        control={form.control}
                        name="sazonal.offerDescription"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700">Descrição da oferta</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                className="min-h-[110px] rounded-2xl border-slate-200"
                                placeholder="Ex: Deposite R$50, jogue R$50 e ganhe 10 Giros Extras"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-900">Upsell/Downsell</p>
                            <p className="text-sm text-slate-600">Opcional</p>
                          </div>
                          <FormField
                            control={form.control}
                            name="sazonal.includeUpsellDownsell"
                            render={({ field }) => (
                              <FormItem className="flex items-center gap-2">
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    className="data-[state=checked]:bg-indigo-600"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        {includeUD && (
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <FormField
                              control={form.control}
                              name="sazonal.upsell"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-slate-700">Upsell</FormLabel>
                                  <FormControl>
                                    <Textarea
                                      {...field}
                                      className="min-h-[90px] rounded-2xl border-slate-200 bg-white"
                                      placeholder="Opcional"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="sazonal.downsell"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-slate-700">Downsell</FormLabel>
                                  <FormControl>
                                    <Textarea
                                      {...field}
                                      className="min-h-[90px] rounded-2xl border-slate-200 bg-white"
                                      placeholder="Opcional"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}
                      </div>
                    </section>
                  ) : (
                    <section className="space-y-4">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-slate-900">
                            Ofertas do funil (6 dias)
                          </h2>
                          <p className="text-sm text-slate-600">
                            Use 'Deposite, jogue e ganhe' (botões) ou 'Outro tipo de oferta' (texto livre) por dia.
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                        >
                          DIA 1–6
                        </Badge>
                      </div>

                      <Tabs defaultValue="day-1" className="w-full">
                        <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-3xl bg-slate-50 p-2">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <TabsTrigger
                              key={i}
                              value={`day-${i + 1}`}
                              className="rounded-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                            >
                              Dia {i + 1}
                            </TabsTrigger>
                          ))}
                        </TabsList>

                        {daysArray.fields.map((field, dayIndex) => {
                          const dayMode = form.watch(`days.${dayIndex}.mode`);
                          const buttonCount = form.watch(`days.${dayIndex}.buttonCount`);
                          const buttons = form.watch(`days.${dayIndex}.buttons`) ?? [];

                          const safeButtons = ensureButtonsLen(buttons, buttonCount);
                          // Mantém o array no form sincronizado com o count
                          if (safeButtons.length !== buttons.length) {
                            form.setValue(`days.${dayIndex}.buttons`, safeButtons, {
                              shouldValidate: false,
                              shouldDirty: true,
                            });
                          }

                          const sourceDayDefault = Math.max(1, dayIndex); // para Dia 2+, default é dia anterior
                          const selectedSourceDay =
                            repeatSourceByDay[dayIndex] ?? sourceDayDefault;
                          const sourceValues =
                            dayIndex > 0
                              ? form.getValues(`days.${selectedSourceDay - 1}`)
                              : null;
                          const canRepeat =
                            dayIndex > 0 && sourceValues && dayHasContent(sourceValues);

                          return (
                            <TabsContent
                              key={field.id}
                              value={`day-${dayIndex + 1}`}
                              className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6"
                            >
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">Dia {dayIndex + 1}</p>
                                  <p className="text-sm text-slate-600">
                                    Se não quiser usar este dia, deixe em branco.
                                  </p>
                                </div>

                                <FormField
                                  control={form.control}
                                  name={`days.${dayIndex}.mode`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <ToggleGroup
                                          type="single"
                                          value={field.value}
                                          onValueChange={(v) => {
                                            if (!v) return;
                                            field.onChange(v);
                                          }}
                                          className="rounded-2xl bg-slate-50 p-1"
                                        >
                                          <ToggleGroupItem
                                            value="A"
                                            className="rounded-xl px-3 py-2 text-xs data-[state=on]:bg-indigo-600 data-[state=on]:text-white sm:text-sm"
                                          >
                                            Deposite, jogue e ganhe
                                          </ToggleGroupItem>
                                          <ToggleGroupItem
                                            value="B"
                                            className="rounded-xl px-3 py-2 text-xs data-[state=on]:bg-indigo-600 data-[state=on]:text-white sm:text-sm"
                                          >
                                            Outro tipo de oferta
                                          </ToggleGroupItem>
                                        </ToggleGroup>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              {dayIndex > 0 && (
                                <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">
                                        Repetir oferta
                                      </p>
                                      <p className="text-sm text-slate-600">
                                        Copie os dados de um dia anterior para este dia.
                                      </p>
                                    </div>

                                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                                      <Select
                                        value={String(selectedSourceDay)}
                                        onValueChange={(v) => {
                                          const n = Number(v);
                                          setRepeatSourceByDay((prev) => ({
                                            ...prev,
                                            [dayIndex]: n,
                                          }));
                                        }}
                                      >
                                        <SelectTrigger className="h-10 w-full rounded-2xl border-slate-200 bg-white sm:w-[210px]">
                                          <SelectValue placeholder="Escolha o dia" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl">
                                          {Array.from({ length: dayIndex }).map((_, i) => {
                                            const sourceDay = i + 1;
                                            const v = form.getValues(`days.${sourceDay - 1}`);
                                            const ok = dayHasContent(v);
                                            return (
                                              <SelectItem
                                                key={sourceDay}
                                                value={String(sourceDay)}
                                                disabled={!ok}
                                              >
                                                Dia {sourceDay}{!ok ? " (vazio)" : ""}
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>

                                      <Button
                                        type="button"
                                        className="h-10 w-full rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700 sm:w-auto"
                                        disabled={!canRepeat}
                                        onClick={() => {
                                          if (!sourceValues) return;
                                          const cloned = JSON.parse(JSON.stringify(sourceValues));
                                          form.setValue(`days.${dayIndex}`, cloned, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                          });
                                          showSuccess(
                                            `Oferta do Dia ${selectedSourceDay} repetida no Dia ${dayIndex + 1}.`,
                                          );
                                        }}
                                      >
                                        Repetir
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="mt-6 space-y-5">
                                {dayMode === "A" ? (
                                  <>
                                    <div className="grid gap-4 md:grid-cols-2">
                                      <FormField
                                        control={form.control}
                                        name={`days.${dayIndex}.gameName`}
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel className="text-slate-700">Nome do jogo</FormLabel>
                                            <FormControl>
                                              <Input
                                                {...field}
                                                className="h-11 rounded-2xl border-slate-200"
                                                placeholder='Ex: "Tigre Sortudo"'
                                              />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      <FormField
                                        control={form.control}
                                        name={`days.${dayIndex}.buttonCount`}
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel className="text-slate-700">Quantidade de botões</FormLabel>
                                            <Select
                                              value={String(field.value)}
                                              onValueChange={(v) => field.onChange(Number(v))}
                                            >
                                              <FormControl>
                                                <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white">
                                                  <SelectValue placeholder="Selecione" />
                                                </SelectTrigger>
                                              </FormControl>
                                              <SelectContent className="rounded-2xl">
                                                {[1, 2, 3, 4, 5].map((n) => (
                                                  <SelectItem key={n} value={String(n)}>
                                                    {n}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                    </div>

                                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                                      <div className="mb-3 flex items-center justify-between">
                                        <p className="font-semibold text-slate-900">Textos dos botões</p>
                                        <Badge
                                          variant="secondary"
                                          className="rounded-full bg-indigo-50 text-indigo-700"
                                        >
                                          {buttonCount} botão(ões)
                                        </Badge>
                                      </div>

                                      <div className="grid gap-4">
                                        {Array.from({ length: buttonCount }).map((_, i) => (
                                          <FormField
                                            key={i}
                                            control={form.control}
                                            name={`days.${dayIndex}.buttons.${i}.text`}
                                            render={({ field }) => (
                                              <FormItem>
                                                <FormLabel className="text-slate-700">Botão {i + 1}</FormLabel>
                                                <FormControl>
                                                  <Input
                                                    {...field}
                                                    className="h-11 rounded-2xl border-slate-200 bg-white"
                                                    placeholder="Ex: Deposite R$50, jogue R$50 e ganhe 10 Giros Extras"
                                                  />
                                                </FormControl>
                                                <FormMessage />
                                              </FormItem>
                                            )}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <FormField
                                    control={form.control}
                                    name={`days.${dayIndex}.freeMessage`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-slate-700">Mensagem do dia</FormLabel>
                                        <FormControl>
                                          <Textarea
                                            {...field}
                                            className="min-h-[120px] rounded-2xl border-slate-200"
                                            placeholder="Ex: Participe dos torneios de ate R$25 mil da PGSOFT"
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                )}
                              </div>
                            </TabsContent>
                          );
                        })}
                      </Tabs>

                      <FormMessage />
                    </section>
                  )}

                  <Separator className="bg-slate-100" />

                  {/* BLOCO 4 */}
                  <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Gerar copy</p>

                    </div>
                    <Button
                      type="submit"
                      className="h-11 rounded-2xl bg-indigo-600 px-6 text-white hover:bg-indigo-700"
                    >
                      GERAR COPY
                    </Button>
                  </section>
                </form>
              </Form>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl font-semibold text-slate-900">
                Output
              </CardTitle>
              <p className="text-sm text-slate-600">
                Copie tudo e cole no Google Docs para o time de design montar os banners.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Resumo</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge className="rounded-full bg-indigo-600 text-white hover:bg-indigo-600">
                    {output?.casino}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-50"
                  >
                    {output?.funnel}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="rounded-full bg-amber-50 text-amber-800 hover:bg-amber-50"
                  >
                    {output?.tier}
                  </Badge>
                  {output?.reativacaoRegua && (
                    <Badge
                      variant="secondary"
                      className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                    >
                      {output.reativacaoRegua}
                    </Badge>
                  )}
                </div>
              </div>

              <Card className="rounded-3xl border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="text-base">Saída (copie e cole no Docs)</CardTitle>
                    <Button
                      className="h-10 rounded-2xl bg-indigo-600 px-4 text-white hover:bg-indigo-700"
                      onClick={() => copyToClipboard(output?.copyAll ?? "")}
                      disabled={!output?.copyAll}
                    >
                      COPIAR TUDO
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={output?.copyAll ?? ""}
                    readOnly
                    className="min-h-[520px] resize-y rounded-3xl border-slate-200 bg-white font-mono text-[13px] leading-relaxed text-slate-900 selection:bg-indigo-100 focus-visible:ring-indigo-600"
                    placeholder="A copy vai aparecer aqui após a geração."
                  />
                  <p className="text-xs text-slate-500">
                    Dica: você pode selecionar trechos e copiar, ou usar "Copiar tudo".
                  </p>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="rounded-3xl border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Ações</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-600">Voltar, editar e gerar novamente.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                        onClick={() => setActiveView("form")}
                      >
                        VOLTAR
                      </Button>
                      <Button
                        variant="secondary"
                        className="rounded-2xl"
                        onClick={() => {
                          if (!lastPayload) return;
                          form.reset(lastPayload);
                          setActiveView("form");
                        }}
                      >
                        EDITAR
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Index;