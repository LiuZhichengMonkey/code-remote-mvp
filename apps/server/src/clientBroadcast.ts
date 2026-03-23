export interface JsonBroadcastClient {
  authenticated: boolean;
  ws: {
    send: (payload: string) => void;
  };
}

export function broadcastJsonToAuthenticatedClients(
  clients: Iterable<[string, JsonBroadcastClient]>,
  payload: unknown,
  onError?: (clientId: string, error: unknown) => void
): void {
  const message = JSON.stringify(payload);

  for (const [clientId, client] of clients) {
    if (!client.authenticated) {
      continue;
    }

    try {
      client.ws.send(message);
    } catch (error) {
      onError?.(clientId, error);
    }
  }
}
