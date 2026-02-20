import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronDown, Search } from "lucide-react";

type Props<T extends string> = {
  value?: T;
  onChange: (value: T) => void;
  options: readonly T[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
};

export function CasinoCombobox<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Buscar cassino…",
  label = "Selecione",
  disabled,
}: Props<T>) {
  const [open, setOpen] = React.useState(false);

  const selected = value ? String(value) : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-11 w-full justify-between rounded-2xl border-slate-200 bg-white px-4 text-left text-slate-900 shadow-sm",
            "hover:bg-slate-50",
            "focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-0",
            !selected && "text-slate-500",
          )}
        >
          <span className="truncate">{selected || label}</span>
          <ChevronDown className="h-4 w-4 text-slate-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] rounded-2xl border-slate-200 bg-white p-0 shadow-lg"
      >
        <Command className="rounded-2xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search className="h-4 w-4 text-slate-500" />
            <CommandInput
              placeholder={placeholder}
              className="h-11 border-0 text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <CommandList className="max-h-72">
            <CommandEmpty className="py-8 text-sm text-slate-600">
              Nenhum cassino encontrado.
            </CommandEmpty>
            <CommandGroup className="p-2">
              {options.map((opt) => {
                const isSelected = selected === opt;
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className={cn(
                      "rounded-xl px-3 py-2 text-slate-900",
                      "data-[selected=true]:bg-indigo-50 data-[selected=true]:text-slate-900",
                    )}
                  >
                    <span className="truncate">{opt}</span>
                    {isSelected ? (
                      <Check className="ml-auto h-4 w-4 text-indigo-600" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
