import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YDocManager } from '../../src/crdt/ydoc-manager.js';

describe('YDocManager', () => {
  let manager: YDocManager;

  beforeEach(() => {
    manager = new YDocManager();
  });

  afterEach(() => {
    manager.listDocIds().forEach(id => manager.deleteDoc(id));
  });

  describe('getOrCreate', () => {
    it('should create a new Y.Doc when docId does not exist', () => {
      const doc = manager.getOrCreate('test-doc-1');
      expect(doc).toBeDefined();
      expect(manager.listDocIds()).toContain('test-doc-1');
    });

    it('should return the same Y.Doc instance for the same docId', () => {
      const doc1 = manager.getOrCreate('test-doc-2');
      const doc2 = manager.getOrCreate('test-doc-2');
      expect(doc1).toBe(doc2);
    });
  });

  describe('applyOp', () => {
    it('should apply insert operations correctly', () => {
      manager.applyOp('doc-1', { type: 'insert', pos: 0, text: 'Hello' });
      expect(manager.getContent('doc-1')).toBe('Hello');
    });

    it('should apply multiple insert operations at correct positions', () => {
      manager.applyOp('doc-2', { type: 'insert', pos: 0, text: 'Hello' });
      manager.applyOp('doc-2', { type: 'insert', pos: 5, text: ' World' });
      expect(manager.getContent('doc-2')).toBe('Hello World');
    });

    it('should apply delete operations correctly', () => {
      manager.applyOp('doc-3', { type: 'insert', pos: 0, text: 'Hello World' });
      manager.applyOp('doc-3', { type: 'delete', pos: 5, length: 6 });
      expect(manager.getContent('doc-3')).toBe('Hello');
    });

    it('should handle overlapping operations', () => {
      manager.applyOp('doc-4', { type: 'insert', pos: 0, text: 'abcdef' });
      manager.applyOp('doc-4', { type: 'delete', pos: 1, length: 2 });
      expect(manager.getContent('doc-4')).toBe('adef');
    });

    it('should ignore invalid operations', () => {
      manager.applyOp('doc-5', { type: 'insert', pos: 0, text: 'test' });
      manager.applyOp('doc-5', { type: 'insert', pos: -1, text: 'invalid' } as any);
      manager.applyOp('doc-5', { type: 'delete', pos: 0, length: -1 } as any);
      expect(manager.getContent('doc-5')).toBe('test');
    });
  });

  describe('getContent', () => {
    it('should return empty string for non-existent doc', () => {
      expect(manager.getContent('non-existent')).toBe('');
    });

    it('should return current content after operations', () => {
      manager.applyOp('doc-6', { type: 'insert', pos: 0, text: 'Line 1\nLine 2\nLine 3' });
      expect(manager.getContent('doc-6')).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('deleteDoc', () => {
    it('should remove doc from manager', () => {
      manager.getOrCreate('doc-to-delete');
      manager.deleteDoc('doc-to-delete');
      expect(manager.listDocIds()).not.toContain('doc-to-delete');
    });

    it('should handle deleting non-existent doc gracefully', () => {
      expect(() => manager.deleteDoc('non-existent')).not.toThrow();
    });
  });

  describe('listDocIds', () => {
    it('should return all created doc IDs', () => {
      manager.getOrCreate('doc-a');
      manager.getOrCreate('doc-b');
      manager.getOrCreate('doc-c');
      const ids = manager.listDocIds();
      expect(ids).toContain('doc-a');
      expect(ids).toContain('doc-b');
      expect(ids).toContain('doc-c');
      expect(ids.length).toBe(3);
    });
  });
});