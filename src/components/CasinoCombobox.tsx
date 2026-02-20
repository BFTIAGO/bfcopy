import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, Loader2, Search } from "lucide-react";

type Props<T extends string> = {
  value?: T;
  onChange: (value: T | undefined) => void;
  onSearch: (query: string) => Promise<readonly T[]>;
  placeholder?: string;
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Campo de busca + lista de sugestões (sem dropdown/popover).
 * Só mostra opções DEPOIS de digitar.
 * A seleção acontece ao clicar na sugestão.
 */
export function CasinoCombobox<T extends string>({
  value,
  onChange,
  onSearch,
  placeholder = "Informe o nome do cassino…",
}: Props<T>) {
  const [query, setQuery] = React.useState<string>(value ? String(value) : "");
  const [focused, setFocused] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<readonly T[]>([]);

  React.useEffect(() => {
    // Quando selecionar um cassino, o input espelha.
    if (value) setQuery(String(value));
  }, [value]);

  const normalizedQuery = query.trim();

  // Debounce simples para evitar spam.
  React.useEffect(() => {
    let active = true;
    const t = window.setTimeout(async () => {
      if (!focused) return;
      if (!normalizedQuery) {
        setOptions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await onSearch(normalizedQuery);
        if (!active) return;

        // Garante lista sem duplicatas considerando maiúsculas/minúsculas.
        const seen = new Set<string>();
        const uniq = res.filter((o) => {
          const k = norm(o);
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        setOptions(uniq);
      } finally {
        if (active) setLoading(false);
      }
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(t);
    };
  }, [focused, normalizedQuery, onSearch]);

  const showSuggestions = focused && normalizedQuery.length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            const next = e.target.value;
            // Se o operador começar a digitar e NÃO for só diferença de maiúscula/minúscula,
            // limpamos a seleção anterior.
            if (value && norm(value) !== norm(next)) onChange(undefined);
            setQuery(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn(
            "h-11 rounded-2xl border-slate-200 bg-white pl-10 pr-10 text-slate-900 shadow-sm",
            "placeholder:text-slate-400",
            "focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-0",
          )}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        ) : null}
      </div>

      {showSuggestions ? (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-auto p-1">
            {options.length === 0 && !loading ? (
              <div className="px-3 py-3 text-sm text-slate-600">Nenhum cassino encontrado.</div>
            ) : null}

            {options.map((opt) => {
              const selected = norm(value) === norm(opt);
              return (
                <button
                  key={String(opt)}
                  type="button"
                  onMouseDown={(e) => {
                    // evita blur antes de selecionar
                    e.preventDefault();
                  }}
                  onClick={() => {
                    onChange(opt);
                    setQuery(String(opt));
                    setFocused(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm",
                    selected
                      ? "bg-indigo-50 text-slate-900"
                      : "text-slate-900 hover:bg-slate-50",
                  )}
                >
                  <span className="truncate">{String(opt)}</span>
                  {selected ? (
                    <Check className="ml-auto h-4 w-4 text-indigo-600" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}