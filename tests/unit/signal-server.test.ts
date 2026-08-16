import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeRoomId, sanitizeUserName, sanitizeChatMessage, sanitizeOperation, sanitizeHtml, sanitizeCodeForAI } from '../../src/utils/sanitize.js';

// Test the sanitize utilities which are used by SignalServer
describe('Sanitize Utilities (used by SignalServer)', () => {
  describe('sanitizeRoomId', () => {
    it('should allow alphanumeric, hyphens, and underscores', () => {
      expect(sanitizeRoomId('room-123_abc')).toBe('room-123_abc');
    });

    it('should remove special characters', () => {
      expect(sanitizeRoomId('room@#$%')).toBe('room');
    });

    it('should limit length to 64', () => {
      const long = 'a'.repeat(100);
      expect(sanitizeRoomId(long).length).toBe(64);
    });

    it('should return empty string for empty input', () => {
      expect(sanitizeRoomId('')).toBe('');
    });
  });

  describe('sanitizeUserName', () => {
    it('should allow alphanumeric, spaces, hyphens, underscores', () => {
      expect(sanitizeUserName('John Doe_123')).toBe('John Doe_123');
    });

    it('should remove special characters', () => {
      expect(sanitizeUserName('User<script>alert(1)</script>')).toBe('Userscriptalert1script');
    });

    it('should limit length to 32', () => {
      const long = 'a'.repeat(50);
      expect(sanitizeUserName(long).length).toBe(32);
    });
  });

  describe('sanitizeChatMessage', () => {
    it('should remove control characters', () => {
      expect(sanitizeChatMessage('Hello\x00World\x1F')).toBe('HelloWorld');
    });

    it('should preserve newlines and tabs', () => {
      expect(sanitizeChatMessage('Line1\nLine2\tTab')).toBe('Line1\nLine2\tTab');
    });

    it('should limit length to 1000', () => {
      const long = 'a'.repeat(2000);
      expect(sanitizeChatMessage(long).length).toBe(1000);
    });

    it('should trim whitespace', () => {
      expect(sanitizeChatMessage('  Hello  ')).toBe('Hello');
    });

    it('should return empty string for only control chars', () => {
      expect(sanitizeChatMessage('\x00\x01\x02')).toBe('');
    });
  });

  describe('sanitizeOperation', () => {
    it('should validate insert operations', () => {
      const op = { type: 'insert', pos: 0, text: 'Hello' };
      expect(sanitizeOperation(op)).toEqual(op);
    });

    it('should validate delete operations', () => {
      const op = { type: 'delete', pos: 5, length: 3 };
      expect(sanitizeOperation(op)).toEqual(op);
    });

    it('should validate retain operations', () => {
      const op = { type: 'retain', pos: 0 };
      expect(sanitizeOperation(op)).toEqual(op);
    });

    it('should reject invalid type', () => {
      expect(sanitizeOperation({ type: 'invalid', pos: 0 } as any)).toBeNull();
    });

    it('should reject negative position', () => {
      expect(sanitizeOperation({ type: 'insert', pos: -1, text: 'test' } as any)).toBeNull();
    });

    it('should reject insert with text too long', () => {
      expect(sanitizeOperation({ type: 'insert', pos: 0, text: 'a'.repeat(10001) } as any)).toBeNull();
    });

    it('should reject insert with non-string text', () => {
      expect(sanitizeOperation({ type: 'insert', pos: 0, text: 123 } as any)).toBeNull();
    });

    it('should reject delete with invalid length', () => {
      expect(sanitizeOperation({ type: 'delete', pos: 0, length: -1 } as any)).toBeNull();
      expect(sanitizeOperation({ type: 'delete', pos: 0, length: 0 } as any)).toBeNull();
      expect(sanitizeOperation({ type: 'delete', pos: 0, length: 10001 } as any)).toBeNull();
    });

    it('should reject missing position', () => {
      expect(sanitizeOperation({ type: 'insert', text: 'test' } as any)).toBeNull();
      expect(sanitizeOperation({ type: 'insert', pos: 'invalid', text: 'test' } as any)).toBeNull();
    });
  });

  describe('sanitizeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(sanitizeHtml("<script>alert(1)</script>")).toBe("<script>alert(1)<&#x2F;script>");
      expect(sanitizeHtml('"quoted"')).toBe('"quoted"');
      expect(sanitizeHtml("'single'")).toBe("'single'");
      expect(sanitizeHtml('a&b')).toBe('a&b');
    });
  });

  describe('sanitizeCodeForAI', () => {
    it('should limit code size to 5000 chars', () => {
      const long = 'a'.repeat(10000);
      expect(sanitizeCodeForAI(long).length).toBe(5000);
    });

    it('should not modify short code', () => {
      expect(sanitizeCodeForAI('function test() {}')).toBe('function test() {}');
    });
  });
});

// Test rate limiting logic
describe('Rate Limiting Logic', () => {
  const RATE_LIMIT_WINDOW_MS = 1000;
  const MAX_EVENTS_PER_WINDOW = 30;

  interface RateLimitEntry {
    count: number;
    windowStart: number;
  }

  function checkRateLimit(rateLimits: Map<string, RateLimitEntry>, socketId: string): boolean {
    const now = Date.now();
    const entry = rateLimits.get(socketId);
    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimits.set(socketId, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= MAX_EVENTS_PER_WINDOW) {
      return false;
    }
    entry.count++;
    return true;
  }

  it('should allow first request', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    expect(checkRateLimit(rateLimits, 'socket-1')).toBe(true);
  });

  it('should track count per socket', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    checkRateLimit(rateLimits, 'socket-1');
    checkRateLimit(rateLimits, 'socket-1');
    checkRateLimit(rateLimits, 'socket-1');
    expect(rateLimits.get('socket-1')!.count).toBe(3);
  });

  it('should enforce max events per window', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    for (let i = 0; i < MAX_EVENTS_PER_WINDOW; i++) {
      expect(checkRateLimit(rateLimits, 'socket-1')).toBe(true);
    }
    expect(checkRateLimit(rateLimits, 'socket-1')).toBe(false);
  });

  it('should reset after window expires', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    for (let i = 0; i < MAX_EVENTS_PER_WINDOW; i++) {
      checkRateLimit(rateLimits, 'socket-1');
    }
    
    // Manually expire the window
    const entry = rateLimits.get('socket-1')!;
    entry.windowStart = Date.now() - RATE_LIMIT_WINDOW_MS - 1;
    
    expect(checkRateLimit(rateLimits, 'socket-1')).toBe(true);
    expect(rateLimits.get('socket-1')!.count).toBe(1);
  });

  it('should track separate limits per socket', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    for (let i = 0; i < MAX_EVENTS_PER_WINDOW; i++) {
      checkRateLimit(rateLimits, 'socket-1');
    }
    // socket-2 should still be allowed
    expect(checkRateLimit(rateLimits, 'socket-2')).toBe(true);
  });
});

// Test AI rate limiting
describe('AI Rate Limiting', () => {
  interface RateLimitEntry {
    count: number;
    resetAt: number;
  }

  const RATE_LIMIT = 20;
  const RATE_WINDOW_MS = 60_000;

  function checkRateLimit(rateLimits: Map<string, RateLimitEntry>, userId: string): boolean {
    const now = Date.now();
    const entry = rateLimits.get(userId);
    if (!entry || now > entry.resetAt) {
      rateLimits.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    if (entry.count >= RATE_LIMIT) return false;
    entry.count++;
    return true;
  }

  it('should allow requests under limit', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    expect(checkRateLimit(rateLimits, 'user-1')).toBe(true);
  });

  it('should track count per user', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    checkRateLimit(rateLimits, 'user-1');
    checkRateLimit(rateLimits, 'user-1');
    expect(rateLimits.get('user-1')!.count).toBe(2);
  });

  it('should reject requests over limit', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect(checkRateLimit(rateLimits, 'user-2')).toBe(true);
    }
    expect(checkRateLimit(rateLimits, 'user-2')).toBe(false);
  });

  it('should reset after window expires', () => {
    const rateLimits = new Map<string, RateLimitEntry>();
    for (let i = 0; i < RATE_LIMIT; i++) {
      checkRateLimit(rateLimits, 'user-3');
    }
    
    const entry = rateLimits.get('user-3')!;
    entry.resetAt = Date.now() - 1000;
    
    expect(checkRateLimit(rateLimits, 'user-3')).toBe(true);
    expect(rateLimits.get('user-3')!.count).toBe(1);
  });
});