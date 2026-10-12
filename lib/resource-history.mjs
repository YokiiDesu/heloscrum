// Adapted from lazydocker's appendStats/eraseOldHistory/GetLastStats (MIT),
// pkg/commands/container_stats.go at 7e7aadc. See THIRD_PARTY_NOTICES.md.
// HeloScrum changes: keyed histories, bounded storage, removal of expired series.
export class ResourceHistory {
  constructor(duration = 5 * 60 * 1000) { this.duration = duration; this.history = new Map(); }
  record(containers, now = Date.now()) {
    const active = new Set(containers.map(c => c.id));
    for (const id of this.history.keys()) if (!active.has(id)) this.history.delete(id);
    return containers.map(container => {
      const history = (this.history.get(container.id) || []).filter(sample => now - sample.at < this.duration);
      const cpu = Number.parseFloat(container.cpu);
      if (Number.isFinite(cpu)) history.push({at:now, cpu});
      this.history.set(container.id, history.slice(-60));
      return {...container, history:this.history.get(container.id)};
    });
  }
}
