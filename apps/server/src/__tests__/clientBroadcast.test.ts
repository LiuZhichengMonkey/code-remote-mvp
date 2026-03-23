import { broadcastJsonToAuthenticatedClients } from '../clientBroadcast';

describe('broadcastJsonToAuthenticatedClients', () => {
  test('broadcasts only to authenticated clients and reports send failures', () => {
    const sent: string[] = [];
    const errorCallback = jest.fn();
    const expectedPayload = { type: 'ui_preferences_saved', updatedAt: 123 };

    const clients = new Map([
      ['ok', {
        authenticated: true,
        ws: {
          send: (payload: string) => sent.push(`ok:${payload}`)
        }
      }],
      ['skip', {
        authenticated: false,
        ws: {
          send: (payload: string) => sent.push(`skip:${payload}`)
        }
      }],
      ['boom', {
        authenticated: true,
        ws: {
          send: () => {
            throw new Error('send failed');
          }
        }
      }]
    ]);

    broadcastJsonToAuthenticatedClients(clients.entries(), expectedPayload, errorCallback);

    expect(sent).toEqual([
      `ok:${JSON.stringify(expectedPayload)}`
    ]);
    expect(errorCallback).toHaveBeenCalledTimes(1);
    expect(errorCallback).toHaveBeenCalledWith('boom', expect.any(Error));
  });
});
