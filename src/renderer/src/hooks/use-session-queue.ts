import { useCallback, useEffect, useState } from "react";
import type { WidgetSessionView } from "@application/contracts";

export function useSessionQueue() {
  const [sessions, setSessions] = useState<readonly WidgetSessionView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    void window.synapse.sessions.listWidgetQueue().then((next) => { setSessions(next); setLoaded(true); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    reload();
    const unsubscribe = window.synapse.window.onSessionsChanged(reload);
    const timer = window.setInterval(reload, 5_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [reload]);
  return { sessions, loaded, reload };
}
