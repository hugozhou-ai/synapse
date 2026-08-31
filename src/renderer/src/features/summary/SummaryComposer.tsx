import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, LoaderCircle, NotebookPen, RefreshCw, Sparkles, X } from "lucide-react";
import type { ApplicationSettings } from "@application/ports";
import type { ConversationTurnsView, NotesTargetsView, SummaryContentView, SummaryProfileView } from "@application/contracts";
import { ErrorBanner, InfoBanner, PageHeader } from "../../components/common";
import { NotesTargetPicker } from "../../components/NotesTargetPicker";
import { Select } from "../../components/Select";
import { useSummaryDraft } from "../../hooks/use-summary-draft";
import { messageOf } from "../../lib/format";
import { TurnSelector } from "./TurnSelector";

export function SummaryComposer({ sessionId, autoGenerate = false, onClose }: { sessionId: string; autoGenerate?: boolean; onClose(): void }) {
  const [conversation, setConversation] = useState<ConversationTurnsView | null>(null);
  const [profiles, setProfiles] = useState<readonly SummaryProfileView[]>([]);
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profileId, setProfileId] = useState("");
  const [syncNotes, setSyncNotes] = useState(false);
  const [notesAccount, setNotesAccount] = useState("");
  const [notesFolder, setNotesFolder] = useState("Synapse");
  const [notesTargets, setNotesTargets] = useState<NotesTargetsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const draft = useSummaryDraft();
  const autoGenerationStarted = useRef(false);

  const loadConversation = useCallback(() => {
    void window.synapse.sessions.turns(sessionId).then((next) => {
      setConversation(next);
      setSelected(new Set(next.turns.filter((turn) => autoGenerate ? turn.status !== "running" : turn.selectedByDefault).map((turn) => turn.id)));
    }).catch((reason) => setLoadError(messageOf(reason)));
  }, [autoGenerate, sessionId]);

  useEffect(() => {
    if (!autoGenerate || autoGenerationStarted.current) return;
    autoGenerationStarted.current = true;
    draft.beginGeneration();
    void window.synapse.summaries.generateDefault(sessionId).then(draft.acceptGenerated).catch(draft.fail);
  }, [autoGenerate, sessionId]);

  useEffect(() => {
    loadConversation();
    void Promise.all([window.synapse.profiles.list(), window.synapse.settings.read()]).then(([nextProfiles, nextSettings]) => {
      setProfiles(nextProfiles); setSettings(nextSettings);
      setProfileId(nextProfiles.find((profile) => profile.isDefault)?.id ?? nextProfiles[0]?.id ?? "");
      setSyncNotes(nextSettings.syncNotesByDefault);
      setNotesAccount(nextSettings.notesAccount ?? ""); setNotesFolder(nextSettings.notesFolder);
    }).catch((reason) => setLoadError(messageOf(reason)));
  }, [loadConversation]);

  useEffect(() => {
    if (autoGenerate || !syncNotes || notesTargets) return;
    void window.synapse.settings.notesTargets().then(setNotesTargets).catch((reason) => setLoadError(`无法读取 Apple Notes 目标：${messageOf(reason)}`));
  }, [autoGenerate, notesTargets, syncNotes]);

  const turns = conversation?.turns ?? [];
  const generate = async () => {
    const stopTurnId = [...turns].reverse().find((turn) => turn.status !== "running")?.id;
    if (!stopTurnId || !profileId || selected.size === 0 || !settings || conversation?.syncStatus !== "synced") return;
    draft.beginGeneration();
    try {
      const result = await window.synapse.summaries.generate({
        sessionId, selectedTurnIds: [...selected], profileId, stopTurnId, model: settings.summaryModel,
        syncToNotes: syncNotes, publicationTarget: syncNotes ? { account: notesAccount || null, folder: notesFolder } : null,
      });
      draft.acceptGenerated(result);
    } catch (reason) { draft.fail(reason); }
  };
  const busy = ["generating", "saving", "finalizing"].includes(draft.state.phase);
  const finalized = draft.state.phase === "final";
  const showQuickProgress = autoGenerate && !draft.state.draft && !draft.state.error;

  return <div className="page composer-page">
    <PageHeader eyebrow={autoGenerate ? "QUICK SUMMARY" : "SUMMARY HARNESS"} title={autoGenerate ? "快速整理" : "整理会话"} description={autoGenerate ? "正在使用默认方案整理整个 session。结果仍先保存为草稿，由你确认后成为不可变 final。" : "选择事实来源与整理方案。生成结果先保存为草稿，确认后才会成为不可变 final。"} actions={<button className="ghost" onClick={onClose}><X size={16} />关闭</button>} />
    {loadError && <ErrorBanner message={loadError} />}
    {draft.state.error && <ErrorBanner message={draft.state.error} />}
    {conversation && conversation.syncStatus !== "synced" && <div className="sync-message"><InfoBanner message={conversation.message ?? "Codex 会话尚未同步。"} /><button className="secondary" onClick={loadConversation}><RefreshCw size={14} />重新同步</button></div>}
    {showQuickProgress ? <section className="panel quick-summary-state"><LoaderCircle className="spin" size={24} /><span className="eyebrow">DEFAULT PROFILE / FULL SESSION</span><h2>正在生成整理草稿</h2><p>正在同步全部 turns，并按默认方案提取事实、决策与后续行动。</p></section> : !draft.state.draft ? <div className="composer-grid">
      <section className="panel turns-panel"><div className="panel-head"><div><h2>选择 turns</h2><p>默认选中已完成 turn；失败或中断的 turn 需手动纳入。</p></div><div className="selection-actions"><button onClick={() => setSelected(new Set(turns.filter((turn) => turn.status !== "running").map((turn) => turn.id)))}>全选</button><button onClick={() => setSelected(new Set())}>取消</button></div></div>
        <TurnSelector turns={turns} selected={selected} onChange={setSelected} />
      </section>
      <aside className="panel generation-panel"><h2>整理设置</h2><label>整理方案<Select ariaLabel="整理方案" value={profileId} onChange={setProfileId} options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} /></label>
        <div className="profile-preview"><span>{profiles.find((profile) => profile.id === profileId)?.kind === "template" ? "Markdown 模板" : "系统提示词"}</span><p>{profiles.find((profile) => profile.id === profileId)?.instructions.slice(0, 240)}</p></div>
        <label className="toggle-row"><input type="checkbox" checked={syncNotes} onChange={(event) => setSyncNotes(event.target.checked)} /><span className="toggle" /><div><strong>同步到 Apple Notes</strong><small>{notesFolder || "未选择文件夹"} · 仅 final 后执行</small></div></label>
        {syncNotes && <NotesTargetPicker targets={notesTargets} account={notesAccount} folder={notesFolder} onAccountChange={setNotesAccount} onFolderChange={setNotesFolder} />}
        <div className="source-count"><strong>{selected.size}</strong><span>个 turns 将作为事实来源</span></div>
        <button className="primary wide" disabled={busy || conversation?.syncStatus !== "synced" || selected.size === 0 || !profileId || (syncNotes && !notesFolder.trim())} onClick={generate}>{draft.state.phase === "generating" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}生成草稿</button>
      </aside>
    </div> : <DraftWorkspace state={draft.state} busy={busy || !settings} finalized={finalized} onEdit={draft.edit} onPreview={draft.setPreview} onSave={() => void draft.save()} onFinalize={() => void draft.finalize(syncNotes)} />}
  </div>;
}

function DraftWorkspace({ state, busy, finalized, onEdit, onPreview, onSave, onFinalize }: {
  state: ReturnType<typeof useSummaryDraft>["state"];
  busy: boolean;
  finalized: boolean;
  onEdit(content: SummaryContentView): void;
  onPreview(value: boolean): void;
  onSave(): void;
  onFinalize(): void;
}) {
  const content = state.content; const draft = state.draft;
  if (!content || !draft) return null;
  return <section className="draft-workspace">
    <div className="draft-toolbar"><div><span className={`version-pill ${finalized ? "final" : ""}`}>{finalized ? "FINAL" : "DRAFT"}</span><span>版本 {draft.versionId.slice(0, 8)}</span>{state.autoSaving && <span>自动保存中…</span>}{!state.autoSaving && !finalized && !state.dirty && <span>已自动保存</span>}</div><div><button className="secondary" disabled={busy || finalized} onClick={onSave}>保存草稿</button><button className="primary" disabled={busy || finalized || state.autoSaving} onClick={onFinalize}>{finalized ? <><Check size={15} />已完成</> : <><NotebookPen size={15} />完成并归档</>}</button></div></div>
    <div className="editor-tabs" role="tablist"><button role="tab" aria-selected={!state.preview} className={!state.preview ? "active" : ""} onClick={() => onPreview(false)}>编辑</button><button role="tab" aria-selected={state.preview} className={state.preview ? "active" : ""} onClick={() => onPreview(true)}>预览</button></div>
    {state.preview ? <article className="markdown-preview"><h1>{content.title}</h1><p className="abstract">{content.abstract}</p><div className="tag-row">{content.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><ReactMarkdown>{content.bodyMarkdown}</ReactMarkdown></article> : <div className="editor-form"><label>标题<input disabled={busy} value={content.title} onChange={(event) => onEdit({ ...content, title: event.target.value })} /></label><label>摘要<textarea disabled={busy} rows={3} value={content.abstract} onChange={(event) => onEdit({ ...content, abstract: event.target.value })} /></label><label>标签<input disabled={busy} value={content.tags.join(", ")} onChange={(event) => onEdit({ ...content, tags: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label>Markdown 正文<textarea disabled={busy} className="markdown-editor" value={content.bodyMarkdown} onChange={(event) => onEdit({ ...content, bodyMarkdown: event.target.value })} /></label></div>}
  </section>;
}
