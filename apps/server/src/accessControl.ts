export interface TestTokenConfig {
  ownerId: string;
  token: string;
}

export type AccessMode = 'admin' | 'tester';
export type SessionOwnerType = 'admin' | 'tester';

export interface AccessPermissions {
  canViewAllSessions: boolean;
  canManageSettings: boolean;
}

export interface AccessIdentity {
  accessMode: AccessMode;
  ownerId?: string;
  permissions: AccessPermissions;
}

export interface SessionOwner {
  ownerType: SessionOwnerType;
  ownerId?: string;
}

export const ADMIN_PERMISSIONS: AccessPermissions = {
  canViewAllSessions: true,
  canManageSettings: true
};

export const TESTER_PERMISSIONS: AccessPermissions = {
  canViewAllSessions: false,
  canManageSettings: false
};

export function createAdminAccessIdentity(): AccessIdentity {
  return {
    accessMode: 'admin',
    permissions: { ...ADMIN_PERMISSIONS }
  };
}

export function createTesterAccessIdentity(ownerId: string): AccessIdentity {
  return {
    accessMode: 'tester',
    ownerId,
    permissions: { ...TESTER_PERMISSIONS }
  };
}

export function isAdminAccess(identity: AccessIdentity): boolean {
  return identity.accessMode === 'admin';
}

export function normalizeTestTokenConfigs(value: unknown): TestTokenConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenOwners = new Set<string>();
  const seenTokens = new Set<string>();
  const normalized: TestTokenConfig[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const entry = item as Record<string, unknown>;
    const ownerId = typeof entry.ownerId === 'string' ? entry.ownerId.trim() : '';
    const token = typeof entry.token === 'string' ? entry.token.trim() : '';

    if (!ownerId || !token || seenOwners.has(ownerId) || seenTokens.has(token)) {
      continue;
    }

    seenOwners.add(ownerId);
    seenTokens.add(token);
    normalized.push({ ownerId, token });
  }

  return normalized;
}

export class TokenAuthorizer {
  private readonly adminToken: string;
  private readonly testerByToken: Map<string, string>;

  constructor(adminToken: string, testTokens: TestTokenConfig[] = []) {
    this.adminToken = adminToken;
    this.testerByToken = new Map(testTokens.map(entry => [entry.token, entry.ownerId]));
  }

  resolve(token?: string): AccessIdentity | null {
    if (!token) {
      return null;
    }

    if (token === this.adminToken) {
      return createAdminAccessIdentity();
    }

    const ownerId = this.testerByToken.get(token);
    return ownerId ? createTesterAccessIdentity(ownerId) : null;
  }
}

export function getSessionOwnerFromIdentity(identity: AccessIdentity): SessionOwner {
  if (isAdminAccess(identity)) {
    return { ownerType: 'admin' };
  }

  return {
    ownerType: 'tester',
    ownerId: identity.ownerId
  };
}

export function canIdentityAccessOwner(identity: AccessIdentity, owner: SessionOwner | null): boolean {
  if (isAdminAccess(identity)) {
    return true;
  }

  if (!owner) {
    return false;
  }

  return owner.ownerType === 'tester' && owner.ownerId === identity.ownerId;
}
