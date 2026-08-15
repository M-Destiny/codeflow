import { MetricValue } from '../monitoring/metrics.js';

interface RateLimitEntry { count: number; resetAt: number; }
type CompletionFn = (prompt: string) => Promise<string>;

export class AIPairProgrammer {
  private completions: CompletionFn | null = null;
  private rateLimits = new Map<string, RateLimitEntry>();
  private readonly RATE_LIMIT = 20; // per minute per user
  private readonly RATE_WINDOW_MS = 60_000;
  private cache = new Map<string, { result: any; expires: number }>();

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.MINIMAX_API_KEY;
    if (apiKey) {
      this.completions = this.makeCompletionFn(apiKey);
    }
  }

  private makeCompletionFn(apiKey: string): CompletionFn {
    return async (prompt: string): Promise<string> => {
      const endpoint = process.env.MINIMAX_API_KEY
        ? 'https://api.minimax.chat/v1/text/chatcompletion_pro'
        : 'https://api.openai.com/v1/chat/completions';

      const body: any = {
        model: process.env.MINIMAX_API_KEY ? 'MiniMax-Text-01' : 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a senior software engineer pair programming. Be concise, practical, and focused on correctness.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 400,
        temperature: 0.3,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`AI API error: ${res.status}`);
      const json = await res.json() as any;
      return json.choices?.[0]?.message?.content ?? '';
    };
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);
    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(userId, { count: 1, resetAt: now + this.RATE_WINDOW_MS });
      return true;
    }
    if (entry.count >= this.RATE_LIMIT) return false;
    entry.count++;
    return true;
  }

  async suggestCompletion(code: string, cursorPos: { line: number; column: number }, userId = 'anon'): Promise<any> {
    const cacheKey = `suggest:${code.slice(-100)}:${cursorPos.line}:${cursorPos.column}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.result;

    if (!this.completions) {
      return { startLine: cursorPos.line, endLine: cursorPos.line, suggestion: '// Configure OPENAI_API_KEY or MINIMAX_API_KEY to enable AI suggestions', confidence: 0 };
    }

    if (!this.checkRateLimit(userId)) {
      return { error: 'Rate limited. Try again in a minute.' };
    }

    const lines = code.split('\n');
    const context = lines.slice(Math.max(0, cursorPos.line - 10), cursorPos.line + 5).join('\n');

    const result = await this.completions(
      `Given this code context (cursor at line ${cursorPos.line}, column ${cursorPos.column}):\n${context}\n\nSuggest the next line(s) to complete the current function. Reply ONLY with the code suggestion, no explanation.`
    );

    const suggestion = {
      startLine: cursorPos.line,
      endLine: cursorPos.line + result.split('\n').length - 1,
      suggestion: result.trim(),
      confidence: 0.7,
      model: process.env.MINIMAX_API_KEY ? 'MiniMax-Text-01' : 'GPT-4',
      createdAt: new Date(),
    };

    this.cache.set(cacheKey, { result: suggestion, expires: Date.now() + 30_000 });
    return suggestion;
  }

  async explainCode(code: string, userId = 'anon'): Promise<string> {
    if (!this.completions) return 'AI disabled: set OPENAI_API_KEY or MINIMAX_API_KEY';
    if (!this.checkRateLimit(userId)) return 'Rate limited';

    return this.completions(`Explain this code concisely:\n${code.slice(0, 500)}`);
  }

  async reviewChanges(docContent: string, diff: any[], userId = 'anon'): Promise<string> {
    if (!this.completions) return 'AI disabled';
    if (!this.checkRateLimit(userId)) return 'Rate limited';

    return this.completions(`Review these code changes and give concise feedback (max 3 points):\n${JSON.stringify(diff.slice(0, 10))}`);
  }
}
