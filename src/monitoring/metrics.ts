export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  increment(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  gauge(name: string, value: number) {
    this.gauges.set(name, value);
  }

  decrement(name: string) {
    this.gauges.set(name, Math.max(0, (this.gauges.get(name) ?? 0) - 1));
  }

  get(name: string) {
    return { type: 'counter', value: this.counters.get(name) ?? 0 };
  }

  getAll() {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
