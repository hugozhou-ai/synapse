import { useMemo, useState } from "react";
import type { NotesTargetsView } from "@application/contracts";
import { Select } from "./Select";

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
    <label>账户<Select ariaLabel="账户" value={account} onChange={changeAccount} options={[{ value: "", label: "默认账户" }, ...accountOptions.map((item) => ({ value: item.name, label: item.name }))]} /></label>
    <label>文件夹<Select ariaLabel="文件夹" value={folderValue} onChange={(value) => {
      if (value === "__new__") { setCreatingFolder(true); onFolderChange(""); }
      else { setCreatingFolder(false); onFolderChange(value); }
    }} options={[{ value: "", label: "选择文件夹" }, ...folders.map((name) => ({ value: name, label: name })), { value: "__new__", label: "新建文件夹…" }]} /></label>
    {needsNewFolder && <label>新文件夹名称<input autoFocus value={folder} placeholder="Synapse" onChange={(event) => onFolderChange(event.target.value)} /></label>}
  </div>;
}
