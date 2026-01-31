"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { showSuccess, showError, showLoading, dismissToast } from "@/utils/toast";
import { supabase } from "@/integrations/supabase/client";

const formSchema = z.object({
  gameName: z.string().min(1, "Nome do Jogo é obrigatório."),
  casinoName: z.enum(["B1Bet", "Ginga", "Spartans", "Esporte365", "Outro"]),
  funnelType: z.enum(["FTD", "STD/TTD/4TD", "Reativação", "Retenção"]),
  sequenceDay: z.string().optional(),
  ctaUrl: z.string().url("URL do CTA inválida.").min(1, "URL do CTA é obrigatória."),
  offer1: z.string().min(1, "Oferta Nível 1 é obrigatória."),
  offer2: z.string().min(1, "Oferta Nível 2 é obrigatória."),
  offer3: z.string().min(1, "Oferta Nível 3 é obrigatória."),
  offer4: z.string().optional(),
  offer5: z.string().optional(),
  hasDownsell: z.boolean().default(false),
  referenceCopy: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.funnelType !== "Retenção" && !data.sequenceDay) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Dia da Sequência é obrigatório para este Tipo de Funil.",
      path: ["sequenceDay"],
    });
  }
  if (data.funnelType === "Retenção" && data.sequenceDay) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Dia da Sequência não deve ser preenchido para Retenção.",
      path: ["sequenceDay"],
    });
  }
});

const BetfunnelsCopy = () => {
  const [generatedCopies, setGeneratedCopies] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      gameName: "",
      casinoName: "B1Bet",
      funnelType: "FTD",
      sequenceDay: "1",
      ctaUrl: "",
      offer1: "",
      offer2: "",
      offer3: "",
      offer4: "",
      offer5: "",
      hasDownsell: false,
      referenceCopy: "",
    },
  });

  const funnelType = form.watch("funnelType");
  const hasDownsell = form.watch("hasDownsell");

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setLoading(true);
    setGeneratedCopies(null);
    const toastId = showLoading("Gerando copies...");

    try {
      const { data, error } = await supabase.functions.invoke('generate-copy', {
        body: JSON.stringify(values),
      });

      if (error) {
        throw error;
      }

      // The Edge Function returns a string that needs to be parsed
      const parsedData = data.replace(/```json\n|\n```/g, ''); // Remove markdown code block if present
      const copies = JSON.parse(parsedData);
      setGeneratedCopies(copies);
      showSuccess("Copies geradas com sucesso!");
    } catch (error: any) {
      console.error("Erro ao gerar copies:", error);
      showError(`Erro ao gerar copies: ${error.message || "Tente novamente."}`);
    } finally {
      dismissToast(toastId);
      setLoading(false);
    }
  };

  const renderCopySection = (title: string, content: string | { title: string; body: string } | { title: string; text: string }) => {
    if (!content) return null;

    return (
      <Card className="mb-6 rounded-xl shadow-lg">
        <CardHeader className="bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-t-xl p-4">
          <CardTitle className="text-2xl font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-white rounded-b-xl">
          {typeof content === "string" ? (
            <div className="whitespace-pre-wrap text-gray-800" dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <>
              <p className="font-semibold text-lg text-gray-700">Título:</p>
              <p className="mb-4 p-2 bg-gray-50 rounded-md border border-gray-200 text-gray-800">{content.title}</p>
              <p className="font-semibold text-lg text-gray-700">Corpo/Texto:</p>
              <div className="p-2 bg-gray-50 rounded-md border border-gray-200 text-gray-800" dangerouslySetInnerHTML={{ __html: (content as any).body || (content as any).text }} />
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 p-4 sm:p-8 flex flex-col items-center">
      <Card className="w-full max-w-4xl rounded-3xl shadow-2xl mb-8 bg-white">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-700 text-white rounded-t-3xl p-6 text-center">
          <CardTitle className="text-4xl font-extrabold tracking-tight">
            Betfunnels - Copy
          </CardTitle>
          <p className="text-lg mt-2 opacity-90">
            Gerador de Copywriting Profissional para CRM de Cassinos Online
          </p>
        </CardHeader>
        <CardContent className="p-6 sm:p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="gameName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-gray-700">Nome do Jogo</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Fortune Tiger" {...field} className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="casinoName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-gray-700">Nome do Cassino</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                            <SelectValue placeholder="Selecione o Cassino" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-lg shadow-lg">
                          <SelectItem value="B1Bet">B1Bet</SelectItem>
                          <SelectItem value="Ginga">Ginga</SelectItem>
                          <SelectItem value="Spartans">Spartans</SelectItem>
                          <SelectItem value="Esporte365">Esporte365</SelectItem>
                          <SelectItem value="Outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="funnelType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-gray-700">Tipo de Funil</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                            <SelectValue placeholder="Selecione o Tipo de Funil" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-lg shadow-lg">
                          <SelectItem value="FTD">FTD (First Deposit)</SelectItem>
                          <SelectItem value="STD/TTD/4TD">STD/TTD/4TD (2º/3º/4º Depósito)</SelectItem>
                          <SelectItem value="Reativação">Reativação</SelectItem>
                          <SelectItem value="Retenção">Retenção</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {funnelType !== "Retenção" && (
                  <FormField
                    control={form.control}
                    name="sequenceDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-gray-700">Dia da Sequência</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                              <SelectValue placeholder="Selecione o Dia" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="rounded-lg shadow-lg">
                            {["1", "2", "3", "4", "5"].map((day) => (
                              <SelectItem key={day} value={day}>{day}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <FormField
                control={form.control}
                name="ctaUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold text-gray-700">URL do CTA</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: https://www.seucassino.com/promo" {...field} className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4 p-4 border border-gray-200 rounded-xl bg-gray-50">
                <h3 className="text-xl font-bold text-gray-800">Ofertas (R$ ___ = ___ Giros)</h3>
                {[1, 2, 3, 4, 5].map((level) => (
                  <FormField
                    key={`offer${level}`}
                    control={form.control}
                    name={`offer${level}` as "offer1" | "offer2" | "offer3" | "offer4" | "offer5"}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-medium text-gray-700">Nível {level} {level > 3 && "(Opcional)"}</FormLabel>
                        <FormControl>
                          <Input placeholder={`Ex: 50 = 100 Giros`} {...field} className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>

              {funnelType === "Retenção" && (
                <div className="flex items-center space-x-2 p-4 border border-gray-200 rounded-xl bg-gray-50">
                  <FormField
                    control={form.control}
                    name="hasDownsell"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border-none p-0 shadow-none">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base font-semibold text-gray-700">Tem Downsell?</FormLabel>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-gray-300"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <FormField
                control={form.control}
                name="referenceCopy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold text-gray-700">Copy de Referência (Opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Cole aqui uma copy de referência para o tom e estilo."
                        className="min-h-[120px] rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full py-3 text-lg font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all duration-200" disabled={loading}>
                {loading ? "Gerando..." : "Gerar Copies"}
              </Button>
            </form>
          </Form>

          {generatedCopies && (
            <div className="mt-12">
              <h2 className="text-4xl font-extrabold text-center text-gray-900 mb-8">Copies Geradas</h2>
              <Separator className="my-8 bg-gray-300" />

              {renderCopySection("📧 EMAIL", generatedCopies.email)}
              {renderCopySection("📱 SMS", generatedCopies.sms)}
              {renderCopySection("🔔 PUSH NOTIFICATION", generatedCopies.pushNotification)}
              {renderCopySection("📥 INBOX", generatedCopies.inbox)}
              {renderCopySection("🎯 POPUP", generatedCopies.popup)}

              {generatedCopies.downsell && (
                <>
                  <h3 className="text-3xl font-bold text-center text-gray-800 mt-12 mb-6">Copies de Downsell</h3>
                  <Separator className="my-8 bg-gray-300" />
                  {generatedCopies.downsell.email1 && renderCopySection("📧 EMAIL DOWNSELL 1", generatedCopies.downsell.email1)}
                  {generatedCopies.downsell.email2 && renderCopySection("📧 EMAIL DOWNSELL 2 (URGÊNCIA MÁXIMA)", generatedCopies.downsell.email2)}
                  {generatedCopies.downsell.pushNotification && renderCopySection("🔔 PUSH DOWNSELL", generatedCopies.downsell.pushNotification)}
                  {generatedCopies.downsell.popup && renderCopySection("🎯 POPUP DOWNSELL", generatedCopies.downsell.popup)}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BetfunnelsCopy;