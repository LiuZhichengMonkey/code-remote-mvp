import { safeSendJson } from '../../utils/safeSend';

function makeWs(readyState = 1, sendImpl?: jest.Mock): any {
  return {
    readyState,
    send: sendImpl ?? jest.fn()
  };
}

describe('safeSendJson', () => {
  it('returns false for null or undefined sockets', () => {
    expect(safeSendJson(null, { type: 'x' })).toBe(false);
    expect(safeSendJson(undefined, { type: 'x' })).toBe(false);
  });

  it('returns false when the socket is not in OPEN state', () => {
    const ws = makeWs(3); // CLOSED
    expect(safeSendJson(ws, { type: 'x' })).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('serializes and sends when ready and healthy', () => {
    const ws = makeWs(1, jest.fn());
    const result = safeSendJson(ws, { type: 'auth_success', id: 1 });
    expect(result).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'auth_success', id: 1 });
  });

  it('returns false and logs when ws.send throws', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ws = makeWs(1, jest.fn(() => { throw new Error('socket closed'); }));
    expect(safeSendJson(ws, { type: 'x' })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns false when the payload is not serializable', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const circular: any = {};
    circular.self = circular;
    const ws = makeWs(1, jest.fn());
    expect(safeSendJson(ws, circular)).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
