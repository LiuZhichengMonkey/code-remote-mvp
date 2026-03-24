import fs from 'fs';
import path from 'path';
import { AccessIdentity, canIdentityAccessOwner, getSessionOwnerFromIdentity, SessionOwner } from './accessControl';
import { Provider } from './session/provider';

export interface SessionAccessRecord extends SessionOwner {
  provider: Provider;
  projectId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

type SessionAccessStoreData = Record<string, SessionAccessRecord>;

function createRecordKey(provider: Provider, projectId: string, sessionId: string): string {
  return `${provider}:${projectId}:${sessionId}`;
}

export class SessionAccessStore {
  private readonly accessFile: string;
  private cache: SessionAccessStoreData | null = null;

  constructor(workspaceRoot?: string) {
    const root = workspaceRoot || process.cwd();
    this.accessFile = path.join(root, '.coderemote', 'session-access.json');
  }

  private ensureDirectory(): void {
    const directory = path.dirname(this.accessFile);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  private loadStore(): SessionAccessStoreData {
    if (this.cache) {
      return this.cache;
    }

    try {
      if (!fs.existsSync(this.accessFile)) {
        const emptyStore: SessionAccessStoreData = {};
        this.cache = emptyStore;
        return emptyStore;
      }

      const content = fs.readFileSync(this.accessFile, 'utf-8').trim();
      const parsed = content ? JSON.parse(content) : {};
      this.cache = parsed && typeof parsed === 'object'
        ? parsed as SessionAccessStoreData
        : {};
      return this.cache;
    } catch {
      const emptyStore: SessionAccessStoreData = {};
      this.cache = emptyStore;
      return emptyStore;
    }
  }

  private saveStore(store: SessionAccessStoreData): void {
    this.ensureDirectory();
    fs.writeFileSync(this.accessFile, JSON.stringify(store, null, 2), 'utf-8');
    this.cache = store;
  }

  getRecord(provider: Provider, projectId: string, sessionId: string): SessionAccessRecord | null {
    const store = this.loadStore();
    return store[createRecordKey(provider, projectId, sessionId)] || null;
  }

  findRecordBySessionId(sessionId: string, provider?: Provider): SessionAccessRecord | null {
    const store = this.loadStore();

    for (const record of Object.values(store)) {
      if (record.sessionId !== sessionId) {
        continue;
      }

      if (provider && record.provider !== provider) {
        continue;
      }

      return record;
    }

    return null;
  }

  assignSession(provider: Provider, projectId: string, sessionId: string, identity: AccessIdentity): SessionAccessRecord {
    const store = this.loadStore();
    const key = createRecordKey(provider, projectId, sessionId);
    const existing = store[key];
    const timestamp = Date.now();
    const owner = getSessionOwnerFromIdentity(identity);

    const record: SessionAccessRecord = {
      provider,
      projectId,
      sessionId,
      ownerType: owner.ownerType,
      ...(owner.ownerId ? { ownerId: owner.ownerId } : {}),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    store[key] = record;
    this.saveStore(store);
    return record;
  }

  moveSession(provider: Provider, projectId: string, oldSessionId: string, newSessionId: string): SessionAccessRecord | null {
    const store = this.loadStore();
    const oldKey = createRecordKey(provider, projectId, oldSessionId);
    const existing = store[oldKey];

    if (!existing) {
      return null;
    }

    const nextRecord: SessionAccessRecord = {
      ...existing,
      sessionId: newSessionId,
      updatedAt: Date.now()
    };

    delete store[oldKey];
    store[createRecordKey(provider, projectId, newSessionId)] = nextRecord;
    this.saveStore(store);
    return nextRecord;
  }

  deleteSession(provider: Provider, projectId: string, sessionId: string): void {
    const store = this.loadStore();
    const key = createRecordKey(provider, projectId, sessionId);
    if (!store[key]) {
      return;
    }

    delete store[key];
    this.saveStore(store);
  }

  canAccessSession(identity: AccessIdentity, provider: Provider, projectId: string, sessionId: string): boolean {
    const record = this.getRecord(provider, projectId, sessionId);
    return canIdentityAccessOwner(identity, record);
  }
}
