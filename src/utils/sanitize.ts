/**
 * Input sanitization utilities to prevent XSS and injection attacks
 */

/**
 * Sanitize HTML/text input by escaping dangerous characters
 * Prevents XSS when content is rendered in the browser
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize chat message - limit length and remove control characters
 */
export function sanitizeChatMessage(input: string): string {
  // Remove null bytes and control characters (except newline/tab)
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Limit length
  sanitized = sanitized.slice(0, 1000);
  // Trim
  return sanitized.trim();
}

/**
 * Sanitize room ID - alphanumeric and hyphens only
 */
export function sanitizeRoomId(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64);
}

/**
 * Sanitize user name - alphanumeric, spaces, hyphens, underscores
 */
export function sanitizeUserName(input: string): string {
  return input.replace(/[^a-zA-Z0-9\s\-_]/g, '').slice(0, 32);
}

/**
 * Sanitize code content for AI prompts - limit size to prevent injection
 */
export function sanitizeCodeForAI(input: string): string {
  // Limit code context size
  return input.slice(0, 5000);
}

/**
 * Validate and sanitize operation positions
 */
export function sanitizeOperation(op: { type: string; pos: number; text?: string; length?: number }): typeof op | null {
  if (!op || typeof op.pos !== 'number' || op.pos < 0) return null;
  if (op.type === 'insert' && (typeof op.text !== 'string' || op.text.length > 10000)) return null;
  if (op.type === 'delete' && (typeof op.length !== 'number' || op.length <= 0 || op.length > 10000)) return null;
  if (op.type !== 'insert' && op.type !== 'delete' && op.type !== 'retain') return null;
  return op;
}