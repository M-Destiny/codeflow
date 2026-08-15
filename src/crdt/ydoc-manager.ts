import * as Y from 'yjs';

export class YDocManager {
  private docs = new Map<string, Y.Doc>();

  getOrCreate(docId: string): Y.Doc {
    let doc = this.docs.get(docId);
    if (!doc) {
      doc = new Y.Doc();
      this.docs.set(docId, doc);
    }
    return doc;
  }

  applyOp(docId: string, op: { type: string; pos: number; text?: string; length?: number }): void {
    const doc = this.getOrCreate(docId);
    const ytext = doc.getText('content');

    doc.transact(() => {
      if (op.type === 'insert' && op.text) {
        ytext.insert(op.pos, op.text);
      } else if (op.type === 'delete' && op.length) {
        ytext.delete(op.pos, op.length);
      }
    });
  }

  getContent(docId: string): string {
    const doc = this.docs.get(docId);
    if (!doc) return '';
    return doc.getText('content').toString();
  }

  getAwareness(docId: string): Map<number, { user?: { name: string; color: string }; cursor?: { line: number; column: number } }> {
    // Awareness is managed by the provider; return empty for now
    return new Map();
  }

  deleteDoc(docId: string): void {
    const doc = this.docs.get(docId);
    if (doc) {
      doc.destroy();
      this.docs.delete(docId);
    }
  }

  listDocIds(): string[] {
    return Array.from(this.docs.keys());
  }
}
