/**
 * How long to wait before the next attempt to save edits that could not reach the server:
 * 2 s, 4 s, 8 s … up to 30 s. Unsaved edits live only in this tab, so the editor keeps trying
 * on its own instead of waiting for a click (bugs.md finding 3); the cap keeps a long outage
 * from turning into minutes of silence once the server is back.
 */
export function retryDelay(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(30_000, 2_000 * 2 ** Math.min(n, 10));
}
