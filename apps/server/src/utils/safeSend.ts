import type { WebSocket } from 'ws';

const OPEN_STATE = 1;

/**
 * Safely send a JSON-serializable payload over a WebSocket.
 *
 * Returns `true` if the frame was handed to the underlying socket, `false`
 * if the socket was already closing/closed or if the send raised. Errors
 * are logged but never thrown, so the caller doesn't need to wrap each
 * `ws.send` in a try/catch.
 */
export function safeSendJson(
  ws: WebSocket | null | undefined,
  payload: unknown
): boolean {
  if (!ws || ws.readyState !== OPEN_STATE) {
    return false;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    console.error('[safeSendJson] Failed to serialize payload:', error);
    return false;
  }

  try {
    ws.send(serialized);
    return true;
  } catch (error) {
    // Socket is likely already closed by the time we tried to send.
    // Swallow the error — the disconnect handler will clean up the client.
    if (error instanceof Error) {
      console.error('[safeSendJson] ws.send failed:', error.message);
    }
    return false;
  }
}
