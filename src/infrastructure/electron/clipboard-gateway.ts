import { clipboard } from "electron";
import type { TextClipboardGateway } from "@application/ports";

export class ElectronTextClipboardGateway implements TextClipboardGateway {
  writeText(value: string): void { clipboard.writeText(value); }
}
