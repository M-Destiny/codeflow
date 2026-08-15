import { v4 as uuid } from 'uuid';
import type { Document } from '../types.js';

export class DocManager {
  private docs = new Map<string, Document>();
  private socket: any = null;

  setSocket(io: any) { this.socket = io; }

  getDoc(id: string): Document | undefined {
    return this.docs.get(id);
  }

  createDoc(name: string, ownerId: string): Document {
    const doc: Document = {
      id: uuid(),
      name,
      content: '',
      ownerId,
      revision: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.docs.set(doc.id, doc);
    return doc;
  }

  listDocs(): Document[] {
    return Array.from(this.docs.values());
  }

  updateDoc(id: string, content: string, userId: string): Document | undefined {
    const doc = this.docs.get(id);
    if (!doc) return undefined;
    doc.content = content;
    doc.revision++;
    doc.updatedAt = new Date();
    if (this.socket) {
      this.socket.to(doc.id).emit('doc:update', { docId: id, content, revision: doc.revision, userId });
    }
    return doc;
  }

  applyOperation(docId: string, op: any, userId: string): Document | undefined {
    const doc = this.docs.get(docId);
    if (!doc) return undefined;

    switch (op.type) {
      case 'insert':
        doc.content = doc.content.slice(0, op.pos) + (op.text ?? '') + doc.content.slice(op.pos);
        break;
      case 'delete':
        doc.content = doc.content.slice(0, op.pos) + doc.content.slice(op.pos + (op.length ?? 0));
        break;
    }

    doc.revision++;
    doc.updatedAt = new Date();

    if (this.socket) {
      this.socket.to(docId).emit('operation', { ...op, userId, revision: doc.revision });
    }

    return doc;
  }
}
