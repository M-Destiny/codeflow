export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  increment(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  gauge(name: string, value: number) {
    this.gauges.set(name, value);
  }

  decrement(name: string) {
    this.gauges.set(name, Math.max(0, (this.gauges.get(name) ?? 0) - 1));
  }

  histogram(name: string, value: number) {
    const arr = this.histograms.get(name) ?? [];
    arr.push(value);
    // Keep only last 1000 values for memory efficiency
    if (arr.length > 1000) arr.shift();
    this.histograms.set(name, arr);
  }

  get(name: string) {
    return { type: 'counter', value: this.counters.get(name) ?? 0 };
  }

  getAll() {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([k, v]) => [
          k,
          {
            count: v.length,
            sum: v.reduce((a, b) => a + b, 0),
            min: Math.min(...v),
            max: Math.max(...v),
            avg: v.reduce((a, b) => a + b, 0) / v.length,
          },
        ])
      ),
    };
  }

  // Get Prometheus-formatted metrics
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    
    // Counters
    for (const [name, value] of this.counters) {
      lines.push(`# HELP codeflow_${name}_total Total ${name}`);
      lines.push(`# TYPE codeflow_${name}_total counter`);
      lines.push(`codeflow_${name}_total ${value}`);
    }
    
    // Gauges
    for (const [name, value] of this.gauges) {
      lines.push(`# HELP codeflow_${name} Current ${name}`);
      lines.push(`# TYPE codeflow_${name} gauge`);
      lines.push(`codeflow_${name} ${value}`);
    }
    
    // Histograms (as summary)
    for (const [name, values] of this.histograms) {
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        lines.push(`# HELP codeflow_${name}_seconds ${name} latency in seconds`);
        lines.push(`# TYPE codeflow_${name}_seconds summary`);
        lines.push(`codeflow_${name}_seconds_sum ${sum / 1000}`);
        lines.push(`codeflow_${name}_seconds_count ${values.length}`);
      }
    }
    
    return lines.join('\n') + '\n';
  }
}
