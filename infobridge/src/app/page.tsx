import { redirect } from "next/navigation";

// A raiz não tem conteúdo próprio: encaminha direto para o painel.
export default function Home() {
  redirect("/info-analise");
}
