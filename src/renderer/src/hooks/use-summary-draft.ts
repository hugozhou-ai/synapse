import { useEffect, useReducer, useRef } from "react";
import type { SummaryContentView, SummaryDraft } from "@application/contracts";
import { messageOf } from "../lib/format";

type Phase = "selecting" | "generating" | "editing" | "saving" | "finalizing" | "final";
interface DraftState {
  readonly phase: Phase;
  readonly draft: SummaryDraft | null;
  readonly content: SummaryContentView | null;
  readonly dirty: boolean;
  readonly autoSaving: boolean;
  readonly preview: boolean;
  readonly error: string | null;
}

type Action =
  | { type: "generation-started" }
  | { type: "generation-completed"; draft: SummaryDraft }
  | { type: "failed"; message: string; dirty?: boolean }
  | { type: "edited"; content: SummaryContentView }
  | { type: "auto-save-started" }
  | { type: "auto-save-completed"; draft: SummaryDraft; clean: boolean }
  | { type: "save-started" }
  | { type: "save-completed"; draft: SummaryDraft }
  | { type: "finalize-started" }
  | { type: "finalized" }
  | { type: "preview-changed"; preview: boolean };

const initialState: DraftState = { phase: "selecting", draft: null, content: null, dirty: false, autoSaving: false, preview: true, error: null };

function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {
    case "generation-started": return { ...state, phase: "generating", error: null };
    case "generation-completed": return { ...state, phase: "editing", draft: action.draft, content: action.draft.content, dirty: false, error: null };
    case "failed": return { ...state, phase: state.draft ? "editing" : "selecting", autoSaving: false, dirty: action.dirty ?? state.dirty, error: action.message };
    case "edited": return { ...state, content: action.content, dirty: true };
    case "auto-save-started": return { ...state, autoSaving: true };
    case "auto-save-completed": return { ...state, draft: action.draft, autoSaving: false, dirty: action.clean ? false : state.dirty };
    case "save-started": return { ...state, phase: "saving", dirty: false, error: null };
    case "save-completed": return { ...state, phase: "editing", draft: action.draft, dirty: false };
    case "finalize-started": return { ...state, phase: "finalizing", dirty: false, error: null };
    case "finalized": return { ...state, phase: "final", dirty: false, autoSaving: false };
    case "preview-changed": return { ...state, preview: action.preview };
  }
}

export function useSummaryDraft() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const editRevision = useRef(0);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!state.dirty || !state.draft || !state.content || state.phase === "final") return;
    const revision = editRevision.current;
    const draft = state.draft;
    const content = state.content;
    const timer = window.setTimeout(() => {
      dispatch({ type: "auto-save-started" });
      const operation = window.synapse.summaries.updateDraft({ documentId: draft.documentId, content })
        .then((next) => dispatch({ type: "auto-save-completed", draft: next, clean: editRevision.current === revision }))
        .catch((reason) => dispatch({ type: "failed", message: messageOf(reason) }));
      pendingSave.current = operation;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [state.content, state.dirty, state.draft, state.phase]);

  const edit = (content: SummaryContentView) => { editRevision.current += 1; dispatch({ type: "edited", content }); };
  const save = async () => {
    if (!state.draft || !state.content) return;
    editRevision.current += 1; dispatch({ type: "save-started" });
    try {
      await pendingSave.current;
      const next = await window.synapse.summaries.updateDraft({ documentId: state.draft.documentId, content: state.content });
      dispatch({ type: "save-completed", draft: next });
    } catch (reason) { dispatch({ type: "failed", message: messageOf(reason), dirty: true }); }
  };
  const finalize = async (syncToNotes: boolean) => {
    if (!state.draft || !state.content) return;
    editRevision.current += 1; dispatch({ type: "finalize-started" });
    try {
      await pendingSave.current;
      await window.synapse.summaries.finalize({ documentId: state.draft.documentId, content: state.content, syncToNotes });
      dispatch({ type: "finalized" });
    } catch (reason) { dispatch({ type: "failed", message: messageOf(reason), dirty: true }); }
  };

  return {
    state,
    beginGeneration: () => dispatch({ type: "generation-started" }),
    acceptGenerated: (draft: SummaryDraft) => dispatch({ type: "generation-completed", draft }),
    fail: (reason: unknown) => dispatch({ type: "failed", message: messageOf(reason) }),
    setPreview: (preview: boolean) => dispatch({ type: "preview-changed", preview }),
    edit,
    save,
    finalize,
  };
}
