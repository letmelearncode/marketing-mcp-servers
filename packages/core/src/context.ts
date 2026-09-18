import { AsyncLocalStorage } from 'node:async_hooks';
// Carries MCP cancellation across shared tool handlers without adding it to tool inputs.
export const requestSignal = new AsyncLocalStorage<AbortSignal>();
