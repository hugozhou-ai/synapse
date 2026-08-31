import { useCallback, useEffect, useState } from "react";
import type { WidgetSessionView } from "@application/contracts";

export function useSessionQueue() {
  const [sessions, setSessions] = useState<readonly WidgetSessionView[]>([]);
  const reload = useCallback(() => { void window.synapse.sessions.listWidgetQueue().then(setSessions).catch(() => undefined); }, []);
  useEffect(() => {
    reload();
    const unsubscribe = window.synapse.window.onSessionsChanged(reload);
    const timer = window.setInterval(reload, 5_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [reload]);
  return { sessions, reload };
}
