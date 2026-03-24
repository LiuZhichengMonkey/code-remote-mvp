import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createAdminAccessIdentity,
  createTesterAccessIdentity,
  normalizeTestTokenConfigs,
  TokenAuthorizer
} from '../accessControl';
import { SessionAccessStore } from '../sessionAccess';

describe('access control', () => {
  test('normalizes valid test token entries and drops invalid duplicates', () => {
    expect(normalizeTestTokenConfigs([
      { ownerId: 'shenghua.yang', token: 'token-a' },
      { ownerId: 'shenghua.yang', token: 'token-b' },
      { ownerId: 'wenlong.fu', token: 'token-a' },
      { ownerId: 'wenlong.fu', token: 'token-b' },
      { ownerId: '', token: 'empty-owner' },
      { ownerId: 'valid', token: '' },
      null
    ])).toEqual([
      { ownerId: 'shenghua.yang', token: 'token-a' },
      { ownerId: 'wenlong.fu', token: 'token-b' }
    ]);
  });

  test('resolves admin and tester identities from tokens', () => {
    const authorizer = new TokenAuthorizer('admin-token', [
      { ownerId: 'shenghua.yang', token: 'token-a' },
      { ownerId: 'wenlong.fu', token: 'token-b' }
    ]);

    expect(authorizer.resolve('admin-token')).toEqual(createAdminAccessIdentity());
    expect(authorizer.resolve('token-a')).toEqual(createTesterAccessIdentity('shenghua.yang'));
    expect(authorizer.resolve('token-b')).toEqual(createTesterAccessIdentity('wenlong.fu'));
    expect(authorizer.resolve('missing-token')).toBeNull();
  });
});

describe('SessionAccessStore', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-session-access-'));

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('assigns, moves, deletes, and checks tester session ownership', () => {
    const store = new SessionAccessStore(tempRoot);
    const testerA = createTesterAccessIdentity('shenghua.yang');
    const testerB = createTesterAccessIdentity('wenlong.fu');
    const admin = createAdminAccessIdentity();

    store.assignSession('claude', 'E--code-remote-mvp', 'temp-session', testerA);

    expect(store.canAccessSession(testerA, 'claude', 'E--code-remote-mvp', 'temp-session')).toBe(true);
    expect(store.canAccessSession(testerB, 'claude', 'E--code-remote-mvp', 'temp-session')).toBe(false);
    expect(store.canAccessSession(admin, 'claude', 'E--code-remote-mvp', 'temp-session')).toBe(true);

    store.moveSession('claude', 'E--code-remote-mvp', 'temp-session', 'real-session');

    expect(store.canAccessSession(testerA, 'claude', 'E--code-remote-mvp', 'temp-session')).toBe(false);
    expect(store.canAccessSession(testerA, 'claude', 'E--code-remote-mvp', 'real-session')).toBe(true);

    store.deleteSession('claude', 'E--code-remote-mvp', 'real-session');

    expect(store.canAccessSession(testerA, 'claude', 'E--code-remote-mvp', 'real-session')).toBe(false);
  });
});
