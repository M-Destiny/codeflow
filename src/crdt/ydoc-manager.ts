import * as Y from 'yjs';
import { sanitizeOperation } from '../utils/sanitize.js';

interface AwarenessState {
  user?: { name: string; color: string };
  cursor?: { line: number; column: number };
  selection?: { anchor: number; head: number };
}

export class YDocManager {
  private docs = new Map<string, Y.Doc>();
  private awarenessMap = new Map<string, Y.Awareness>();

  getOrCreate(docId: string): Y.Doc {
    let doc = this.docs.get(docId);
    if (!doc) {
      doc = new Y.Doc();
      this.docs.set(docId, doc);
      // Initialize awareness for this doc
      this.awarenessMap.set(docId, new Y.Awareness(doc));
    }
    return doc;
  }

  applyOp(docId: string, op: { type: string; pos: number; text?: string; length?: number }): void {
    const sanitized = sanitizeOperation(op);
    if (!sanitized) return;

    const doc = this.getOrCreate(docId);
    const ytext = doc.getText('content');

    doc.transact(() => {
      if (sanitized.type === 'insert' && sanitized.text) {
        ytext.insert(sanitized.pos, sanitized.text);
      } else if (sanitized.type === 'delete' && sanitized.length) {
        ytext.delete(sanitized.pos, sanitized.length);
      }
    });
  }

  getContent(docId: string): string {
    const doc = this.docs.get(docId);
    if (!doc) return '';
    return doc.getText('content').toString();
  }

  getAwareness(docId: string): Y.Awareness | null {
    return this.awarenessMap.get(docId) ?? null;
  }

  setLocalAwareness(docId: string, clientId: number, state: AwarenessState): void {
    const awareness = this.awarenessMap.get(docId);
    if (!awareness) return;
    awareness.setLocalState({ ...awareness.getLocalState(), [clientId]: state });
  }

  getAwarenessStates(docId: string): Map<number, AwarenessState> {
    const awareness = this.awarenessMap.get(docId);
    if (!awareness) return new Map();
    return awareness.getStates();
  }

  onAwarenessChange(docId: string, callback: (states: Map<number, AwarenessState>, added: number[], updated: number[], removed: number[]) => void): (() => void) | null {
    const awareness = this.awarenessMap.get(docId);
    if (!awareness) return null;
    const handler = () => {
      const { added, updated, removed } = awareness.getStates();
      callback(awareness.getStates(), added, updated, removed);
    };
    awareness.on('change', handler);
    return () => awareness.off('change', handler);
  }

  deleteDoc(docId: string): void {
    const doc = this.docs.get(docId);
    if (doc) {
      doc.destroy();
      this.docs.delete(docId);
    }
    const awareness = this.awarenessMap.get(docId);
    if (awareness) {
      awareness.destroy();
      this.awarenessMap.delete(docId);
    }
  }

  listDocIds(): string[] {
    return Array.from(this.docs.keys());
  }
}
