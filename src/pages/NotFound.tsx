import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-sm font-semibold text-indigo-600">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          Página não encontrada
        </h1>
        <p className="mt-2 text-slate-600">
          Volte para o gerador de copy.
        </p>
        <div className="mt-6">
          <Link to="/">
            <Button className="rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700">
              Ir para o app
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
