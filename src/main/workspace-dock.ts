const DOCK_TRANSITION_SETTLE_MS = 1_100;

export interface WorkspaceDockPort {
  hide(): void;
  show(): Promise<void>;
}

export class WorkspaceDockController {
  private lastShownAt: number | null = null;
  private pendingHide: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dock: WorkspaceDockPort | null) {}

  async show(): Promise<void> {
    this.cancelPendingHide();
    if (!this.dock) return;
    await this.dock.show();
    this.lastShownAt = Date.now();
  }

  hide(): void {
    this.cancelPendingHide();
    if (!this.dock) return;

    const elapsed = this.lastShownAt === null
      ? DOCK_TRANSITION_SETTLE_MS
      : Date.now() - this.lastShownAt;
    const remaining = DOCK_TRANSITION_SETTLE_MS - elapsed;
    if (remaining > 0) {
      this.pendingHide = setTimeout(() => this.hideImmediately(), remaining);
      return;
    }

    this.hideImmediately();
  }

  private hideImmediately(): void {
    this.pendingHide = null;
    this.lastShownAt = null;
    this.dock?.hide();
  }

  private cancelPendingHide(): void {
    if (this.pendingHide === null) return;
    clearTimeout(this.pendingHide);
    this.pendingHide = null;
  }
}
