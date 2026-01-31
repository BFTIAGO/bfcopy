import { MadeWithDyad } from "@/components/made-with-dyad";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-100 to-purple-100 p-4">
      <div className="text-center bg-white p-10 rounded-3xl shadow-2xl max-w-lg mx-auto">
        <h1 className="text-5xl font-extrabold mb-6 text-gray-900 tracking-tight">
          Bem-vindo ao seu App Dyad
        </h1>
        <p className="text-xl text-gray-700 mb-8 leading-relaxed">
          Comece a construir seu projeto incrível aqui!
        </p>
        <Link to="/betfunnels-copy">
          <Button className="px-8 py-4 text-lg font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all duration-200">
            Ir para Betfunnels - Copy
          </Button>
        </Link>
      </div>
      <div className="mt-8">
        <MadeWithDyad />
      </div>
    </div>
  );
};

export default Index;