// Client-only entry point (pulls in the browser-oriented y-websocket provider).
// The server imports '@localsync/shared' and never loads this.
export * from './syncController';
