import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/monitoring/metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('increment', () => {
    it('should increment counter by 1 by default', () => {
      metrics.increment('test_counter');
      expect(metrics.get('test_counter').value).toBe(1);
    });

    it('should increment counter by custom value', () => {
      metrics.increment('test_counter', 5);
      expect(metrics.get('test_counter').value).toBe(5);
    });

    it('should accumulate increments', () => {
      metrics.increment('test_counter', 2);
      metrics.increment('test_counter', 3);
      expect(metrics.get('test_counter').value).toBe(5);
    });

    it('should track multiple counters independently', () => {
      metrics.increment('counter_a', 1);
      metrics.increment('counter_b', 10);
      expect(metrics.get('counter_a').value).toBe(1);
      expect(metrics.get('counter_b').value).toBe(10);
    });
  });

  describe('gauge', () => {
    it('should set gauge value', () => {
      metrics.gauge('test_gauge', 42);
      const all = metrics.getAll();
      expect(all.gauges.test_gauge).toBe(42);
    });

    it('should overwrite previous gauge value', () => {
      metrics.gauge('test_gauge', 10);
      metrics.gauge('test_gauge', 20);
      const all = metrics.getAll();
      expect(all.gauges.test_gauge).toBe(20);
    });

    it('should handle negative values', () => {
      metrics.gauge('test_gauge', -5);
      expect(metrics.getAll().gauges.test_gauge).toBe(-5);
    });

    it('should track multiple gauges independently', () => {
      metrics.gauge('gauge_a', 100);
      metrics.gauge('gauge_b', 200);
      const all = metrics.getAll();
      expect(all.gauges.gauge_a).toBe(100);
      expect(all.gauges.gauge_b).toBe(200);
    });
  });

  describe('decrement', () => {
    it('should decrement gauge by 1', () => {
      metrics.gauge('test_gauge', 10);
      metrics.decrement('test_gauge');
      expect(metrics.getAll().gauges.test_gauge).toBe(9);
    });

    it('should not go below zero', () => {
      metrics.gauge('test_gauge', 0);
      metrics.decrement('test_gauge');
      expect(metrics.getAll().gauges.test_gauge).toBe(0);
    });

    it('should handle negative starting values', () => {
      metrics.gauge('test_gauge', -5);
      metrics.decrement('test_gauge');
      expect(metrics.getAll().gauges.test_gauge).toBe(0); // Math.max(0, -6) = 0
    });

    it('should not affect counters', () => {
      metrics.increment('test_counter', 5);
      metrics.decrement('test_counter'); // decrement only works on gauges
      expect(metrics.get('test_counter').value).toBe(5);
    });
  });

  describe('get', () => {
    it('should return counter type and value', () => {
      metrics.increment('test', 3);
      const result = metrics.get('test');
      expect(result).toEqual({ type: 'counter', value: 3 });
    });

    it('should return zero for non-existent counter', () => {
      const result = metrics.get('non-existent');
      expect(result).toEqual({ type: 'counter', value: 0 });
    });
  });

  describe('getAll', () => {
    it('should return all counters and gauges', () => {
      metrics.increment('counter1', 1);
      metrics.increment('counter2', 2);
      metrics.gauge('gauge1', 10);
      metrics.gauge('gauge2', 20);

      const all = metrics.getAll();
      expect(all.counters).toEqual({ counter1: 1, counter2: 2 });
      expect(all.gauges).toEqual({ gauge1: 10, gauge2: 20 });
    });

    it('should return empty objects when no metrics recorded', () => {
      const all = metrics.getAll();
      expect(all.counters).toEqual({});
      expect(all.gauges).toEqual({});
    });

    it('should return plain objects, not Maps', () => {
      metrics.increment('test', 1);
      metrics.gauge('test', 1);
      const all = metrics.getAll();
      expect(all.counters).toBeInstanceOf(Object);
      expect(all.gauges).toBeInstanceOf(Object);
      expect(all.counters).not.toBeInstanceOf(Map);
      expect(all.gauges).not.toBeInstanceOf(Map);
    });
  });
});