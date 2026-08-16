import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DocManager } from '../../src/server/doc-manager.js';
import type { Document } from '../../src/types.js';

describe('DocManager', () => {
  let manager: DocManager;
  const mockSocket = {
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  };

  beforeEach(() => {
    manager = new DocManager();
    manager.setSocket(mockSocket);
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.listDocs().forEach(d => {
      // DocManager doesn't have deleteDoc, but we can just create new instance
    });
  });

  describe('createDoc', () => {
    it('should create a document with required fields', () => {
      const doc = manager.createDoc('Test Doc', 'user-1');
      expect(doc).toMatchObject({
        name: 'Test Doc',
        ownerId: 'user-1',
        content: '',
        revision: 0,
      });
      expect(doc.id).toBeDefined();
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    it('should generate unique IDs for each document', () => {
      const doc1 = manager.createDoc('Doc 1', 'user-1');
      const doc2 = manager.createDoc('Doc 2', 'user-1');
      expect(doc1.id).not.toBe(doc2.id);
    });

    it('should add document to internal store', () => {
      const doc = manager.createDoc('Test', 'user-1');
      expect(manager.listDocs()).toContainEqual(expect.objectContaining({ id: doc.id }));
    });
  });

  describe('getDoc', () => {
    it('should return document by ID', () => {
      const created = manager.createDoc('Test', 'user-1');
      const retrieved = manager.getDoc(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent ID', () => {
      expect(manager.getDoc('non-existent')).toBeUndefined();
    });
  });

  describe('listDocs', () => {
    it('should return empty array initially', () => {
      expect(manager.listDocs()).toEqual([]);
    });

    it('should return all created documents', () => {
      manager.createDoc('Doc A', 'user-1');
      manager.createDoc('Doc B', 'user-1');
      manager.createDoc('Doc C', 'user-2');
      const docs = manager.listDocs();
      expect(docs.length).toBe(3);
    });
  });

  describe('updateDoc', () => {
    it('should update document content and increment revision', () => {
      const doc = manager.createDoc('Test', 'user-1');
      const updated = manager.updateDoc(doc.id, 'New content', 'user-2');
      expect(updated).toBeDefined();
      expect(updated!.content).toBe('New content');
      expect(updated!.revision).toBe(1);
      expect(updated!.updatedAt).toBeInstanceOf(Date);
    });

    it('should return undefined for non-existent document', () => {
      const result = manager.updateDoc('non-existent', 'content', 'user-1');
      expect(result).toBeUndefined();
    });

    it('should emit doc:update event via socket', () => {
      const doc = manager.createDoc('Test', 'user-1');
      manager.updateDoc(doc.id, 'Updated', 'user-2');
      expect(mockSocket.to).toHaveBeenCalledWith(doc.id);
      expect(mockSocket.emit).toHaveBeenCalledWith('doc:update', expect.objectContaining({
        docId: doc.id,
        content: 'Updated',
        revision: 1,
        userId: 'user-2',
      }));
    });
  });

  describe('applyOperation', () => {
    it('should apply insert operation', () => {
      const doc = manager.createDoc('Test', 'user-1');
      const result = manager.applyOperation(doc.id, { type: 'insert', pos: 0, text: 'Hello' }, 'user-1');
      expect(result).toBeDefined();
      expect(result!.content).toBe('Hello');
      expect(result!.revision).toBe(1);
    });

    it('should apply multiple insert operations at correct positions', () => {
      const doc = manager.createDoc('Test', 'user-1');
      manager.applyOperation(doc.id, { type: 'insert', pos: 0, text: 'Hello' }, 'user-1');
      manager.applyOperation(doc.id, { type: 'insert', pos: 5, text: ' World' }, 'user-1');
      expect(manager.getDoc(doc.id)!.content).toBe('Hello World');
      expect(manager.getDoc(doc.id)!.revision).toBe(2);
    });

    it('should apply delete operation', () => {
      const doc = manager.createDoc('Test', 'user-1');
      manager.applyOperation(doc.id, { type: 'insert', pos: 0, text: 'Hello World' }, 'user-1');
      manager.applyOperation(doc.id, { type: 'delete', pos: 5, length: 6 }, 'user-1');
      expect(manager.getDoc(doc.id)!.content).toBe('Hello');
    });

    it('should return undefined for non-existent document', () => {
      const result = manager.applyOperation('non-existent', { type: 'insert', pos: 0, text: 'test' }, 'user-1');
      expect(result).toBeUndefined();
    });

    it('should emit operation event via socket', () => {
      const doc = manager.createDoc('Test', 'user-1');
      manager.applyOperation(doc.id, { type: 'insert', pos: 0, text: 'Hi' }, 'user-1');
      expect(mockSocket.to).toHaveBeenCalledWith(doc.id);
      expect(mockSocket.emit).toHaveBeenCalledWith('operation', expect.objectContaining({
        type: 'insert',
        pos: 0,
        text: 'Hi',
        userId: 'user-1',
        revision: 1,
      }));
    });

    it('should handle overlapping operations correctly', () => {
      const doc = manager.createDoc('Test', 'user-1');
      manager.applyOperation(doc.id, { type: 'insert', pos: 0, text: 'abcdef' }, 'user-1');
      manager.applyOperation(doc.id, { type: 'delete', pos: 1, length: 2 }, 'user-1');
      expect(manager.getDoc(doc.id)!.content).toBe('adef');
    });
  });
});