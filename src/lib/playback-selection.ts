/** Latest selection wins; delayed callbacks belong to the selection that queued them. */
export class PlaybackSelection {
  private revision = 0;
  private active = true;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  capture(): number {
    return this.revision;
  }
  isCurrent(revision: number): boolean {
    return this.active && revision === this.revision;
  }
  isActive(): boolean {
    return this.active;
  }
  activate(): void {
    this.active = true;
  }
  begin(): number {
    this.revision++;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    return this.revision;
  }
  schedule(revision: number, callback: () => void, delay: number): void {
    if (!this.isCurrent(revision)) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.isCurrent(revision)) callback();
    }, delay);
    this.timers.add(timer);
  }
  dispose(): void {
    this.begin();
    this.active = false;
  }
}
