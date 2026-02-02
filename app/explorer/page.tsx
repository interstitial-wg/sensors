import { Suspense } from "react";
import ExplorerClient from "./ExplorerClient";

function ExplorerFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-900">
      <span className="text-sm text-zinc-500">Loading explorer…</span>
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={<ExplorerFallback />}>
      <ExplorerClient />
    </Suspense>
  );
}
