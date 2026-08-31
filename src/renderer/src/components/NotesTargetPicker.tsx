import { useMemo, useState } from "react";
import type { NotesTargetsView } from "@application/contracts";

export function NotesTargetPicker({ targets, account, folder, onAccountChange, onFolderChange }: {
  targets: NotesTargetsView | null;
  account: string;
  folder: string;
  onAccountChange(value: string): void;
  onFolderChange(value: string): void;
}) {
  const accountOptions = targets?.accounts ?? [];
  const selectedAccount = accountOptions.find((item) => item.name === account) ?? accountOptions[0];
  const folders = useMemo(() => selectedAccount?.folders ?? [], [selectedAccount]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const needsNewFolder = creatingFolder || Boolean(folder) && !folders.includes(folder);
  const folderValue = needsNewFolder ? "__new__" : folder;

  const changeAccount = (value: string) => {
    onAccountChange(value);
    const next = accountOptions.find((item) => item.name === value) ?? accountOptions[0];
    if (!next?.folders.includes(folder)) {
      const first = next?.folders[0];
      if (first) { setCreatingFolder(false); onFolderChange(first); }
      else { setCreatingFolder(true); onFolderChange(folder || "Synapse"); }
    }
  };

  return <div className="notes-target">
    <label>账户<select value={account} onChange={(event) => changeAccount(event.target.value)}><option value="">默认账户</option>{accountOptions.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
    <label>文件夹<select value={folderValue} onChange={(event) => {
      if (event.target.value === "__new__") { setCreatingFolder(true); onFolderChange(""); }
      else { setCreatingFolder(false); onFolderChange(event.target.value); }
    }}><option value="">选择文件夹</option>{folders.map((name) => <option value={name} key={name}>{name}</option>)}<option value="__new__">新建文件夹…</option></select></label>
    {needsNewFolder && <label>新文件夹名称<input autoFocus value={folder} placeholder="Synapse" onChange={(event) => onFolderChange(event.target.value)} /></label>}
  </div>;
}
