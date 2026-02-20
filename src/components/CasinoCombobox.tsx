import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, Search } from "lucide-react";

type Props<T extends string> = {
  value?: T;
  onChange: (value: T) => void;
  options: readonly T[];
  placeholder?: string;
};

/**
 * Campo de busca + lista de sugestões (sem dropdown/popover).
 * O operador digita, vê os cassinos filtrados e clica para selecionar.
 */
export function CasinoCombobox<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Digite o nome do cassino…",
}: Props<T>) {
  const [query, setQuery] = React.useState<string>(value ? String(value) : "");
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    // Mantém o input refletindo a seleção atual.
    setQuery(value ? String(value) : "");
  }, [value]);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = React.useMemo(() => {
    const list = options
      .filter((o) => {
        if (!normalizedQuery) return true;
        return o.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (!normalizedQuery) return a.localeCompare(b);
        const aStarts = a.toLowerCase().startsWith(normalizedQuery);
        const bStarts = b.toLowerCase().startsWith(normalizedQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 10);

    return list;
  }, [options, normalizedQuery]);

  const showSuggestions = focused && filtered.length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn(
            "h-11 rounded-2xl border-slate-200 bg-white pl-10 text-slate-900 shadow-sm",
            "placeholder:text-slate-400",
            "focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-0",
          )}
        />
      </div>

      {showSuggestions ? (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-auto p-1">
            {filtered.map((opt) => {
              const selected = value === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onMouseDown={(e) => {
                    // evita blur antes de selecionar
                    e.preventDefault();
                  }}
                  onClick={() => {
                    onChange(opt);
                    setQuery(opt);
                    setFocused(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm",
                    selected
                      ? "bg-indigo-50 text-slate-900"
                      : "text-slate-900 hover:bg-slate-50",
                  )}
                >
                  <span className="truncate">{opt}</span>
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
