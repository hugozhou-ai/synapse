import { useCallback, useEffect, useState } from "react";
import type { HookInstallationStatus } from "@application/ports";

export function useHookInstallation() {
  const [status, setStatus] = useState<HookInstallationStatus | null>(null);
  const reload = useCallback(() => { void window.synapse.hooks.inspect().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, 10_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  return { status, reload };
}
