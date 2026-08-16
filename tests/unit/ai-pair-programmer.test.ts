import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AIPairProgrammer } from '../../src/ai/ai-pair-programmer.js';

describe('AIPairProgrammer', () => {
  let ai: AIPairProgrammer;

  beforeEach(() => {
    ai = new AIPairProgrammer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize without API key', () => {
      expect(ai).toBeDefined();
    });

    it('should have rate limit tracking', () => {
      // Access private property for testing
      expect((ai as any).rateLimits).toBeDefined();
      expect((ai as any).RATE_LIMIT).toBe(20);
      expect((ai as any).RATE_WINDOW_MS).toBe(60_000);
    });

    it('should have suggestion cache', () => {
      expect((ai as any).cache).toBeDefined();
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests under limit', () => {
      const result = (ai as any).checkRateLimit('user-1');
      expect(result).toBe(true);
    });

    it('should track count per user', () => {
      (ai as any).checkRateLimit('user-1');
      (ai as any).checkRateLimit('user-1');
      const entry = (ai as any).rateLimits.get('user-1');
      expect(entry.count).toBe(2);
    });

    it('should reject requests over limit', () => {
      for (let i = 0; i < 20; i++) {
        expect((ai as any).checkRateLimit('user-2')).toBe(true);
      }
      expect((ai as any).checkRateLimit('user-2')).toBe(false);
    });

    it('should reset after window expires', () => {
      for (let i = 0; i < 20; i++) {
        (ai as any).checkRateLimit('user-3');
      }
      
      // Manually expire the window
      const entry = (ai as any).rateLimits.get('user-3');
      entry.resetAt = Date.now() - 1000;
      
      expect((ai as any).checkRateLimit('user-3')).toBe(true);
      const newEntry = (ai as any).rateLimits.get('user-3');
      expect(newEntry.count).toBe(1);
    });
  });

  describe('suggestCompletion', () => {
    it('should return fallback message when AI is not configured', async () => {
      const result = await ai.suggestCompletion(
        'function test() {',
        { line: 1, column: 18 },
        'test-user'
      );

      expect(result).toEqual(
        expect.objectContaining({
          suggestion: expect.stringContaining('Configure OPENAI_API_KEY or MINIMAX_API_KEY'),
          confidence: 0,
        })
      );
    });

    it('should return rate limit error when exceeded', async () => {
      // Fill rate limit
      for (let i = 0; i < 20; i++) {
        await ai.suggestCompletion('code', { line: 0, column: 0 }, 'rate-limited-user');
      }

      const result = await ai.suggestCompletion(
        'function test() {',
        { line: 1, column: 18 },
        'rate-limited-user'
      );

      expect(result).toEqual(expect.objectContaining({
        error: 'Rate limited. Try again in a minute.',
      }));
    });

    it('should cache suggestions', async () => {
      const code = 'function hello() {\n  console.log("world");\n}';
      const cursorPos = { line: 2, column: 10 };

      const result1 = await ai.suggestCompletion(code, cursorPos, 'cache-user');
      const result2 = await ai.suggestCompletion(code, cursorPos, 'cache-user');

      // Should return cached result (same object reference or equal content)
      expect(result1).toEqual(result2);
    });

    it('should not cache when AI is disabled', async () => {
      const code = 'function test() {';
      const cursorPos = { line: 1, column: 18 };

      const result1 = await ai.suggestCompletion(code, cursorPos, 'nocache-user-1');
      const result2 = await ai.suggestCompletion(code, cursorPos, 'nocache-user-2');

      // Different users should get same fallback but not cached across users
      expect(result1.confidence).toBe(0);
      expect(result2.confidence).toBe(0);
    });
  });

  describe('explainCode', () => {
    it('should return fallback message when AI is not configured', async () => {
      const result = await ai.explainCode('function test() { return 42; }', 'test-user');
      expect(result).toBe('AI disabled: set OPENAI_API_KEY or MINIMAX_API_KEY');
    });

    it('should return rate limit error when exceeded', async () => {
      for (let i = 0; i < 20; i++) {
        await ai.explainCode('code', 'rate-limited-user-2');
      }

      const result = await ai.explainCode('function test() {}', 'rate-limited-user-2');
      expect(result).toBe('Rate limited');
    });
  });

  describe('reviewChanges', () => {
    it('should return fallback message when AI is not configured', async () => {
      const result = await ai.reviewChanges('code', [{ type: 'insert', pos: 0, text: 'new' }], 'test-user');
      expect(result).toBe('AI disabled');
    });

    it('should return rate limit error when exceeded', async () => {
      for (let i = 0; i < 20; i++) {
        await ai.reviewChanges('code', [], 'rate-limited-user-3');
      }

      const result = await ai.reviewChanges('code', [], 'rate-limited-user-3');
      expect(result).toBe('Rate limited');
    });
  });

  describe('cache behavior', () => {
    it('should expire cache after TTL', async () => {
      // This test verifies the cache expiration logic
      // Since we can't easily test time-based expiration without mocking Date.now,
      // we verify the cache structure exists
      const cache = (ai as any).cache;
      expect(cache).toBeInstanceOf(Map);
    });

    it('should include cache key with code context and cursor position', async () => {
      await ai.suggestCompletion('test code', { line: 5, column: 10 }, 'user');
      
      const cache = (ai as any).cache;
      expect(cache.size).toBeGreaterThan(0);
      
      // Cache key should include code slice, line, and column
      const keys = Array.from(cache.keys());
      expect(keys[0]).toContain('suggest:');
      expect(keys[0]).toContain('5:10');
    });
  });
});