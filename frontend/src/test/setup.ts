import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';

afterEach(() => cleanup());

// A brand-new, empty IndexedDB for every test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// jsdom does not implement the modal parts of <dialog>.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// ProseMirror measures text with Range geometry APIs that jsdom lacks.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= zeroRect;
Element.prototype.getClientRects ??= emptyRects;
document.elementFromPoint ??= () => null;
document.elementsFromPoint ??= () => [];

// Real IndexedDB semantics in jsdom (IDBKeyRange etc.), so persistence code is exercised rather than mocked.
import 'fake-indexeddb/auto';
