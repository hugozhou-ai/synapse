import { isAbsolute, relative, resolve } from "node:path";

export function isInstallerVolumeExecutable(executablePath: string): boolean {
  const relativePath = relative("/Volumes", resolve(executablePath));
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
