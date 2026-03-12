/**
 * 异步锁管理器 - 黑板并发安全
 *
 * 支持读写锁，确保多Agent并发写入黑板时的数据一致性
 */

/**
 * 锁类型
 */
export type LockType = 'read' | 'write';

/**
 * 锁持有者信息
 */
interface LockHolder {
  id: string;
  type: LockType;
  acquiredAt: number;
  timeout: number;
}

/**
 * 等待中的锁请求
 */
interface PendingRequest {
  id: string;
  type: LockType;
  resolve: (released: boolean) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * 锁配置
 */
export interface LockManagerConfig {
  /** 写锁超时时间 (ms) */
  writeLockTimeout: number;
  /** 读锁超时时间 (ms) */
  readLockTimeout: number;
  /** 最大等待请求数 */
  maxPendingRequests: number;
}

const DEFAULT_CONFIG: LockManagerConfig = {
  writeLockTimeout: 30000, // 30秒
  readLockTimeout: 60000,  // 60秒
  maxPendingRequests: 100
};

/**
 * 异步锁管理器
 */
export class LockManager {
  private config: LockManagerConfig;
  private holders: Map<string, LockHolder[]> = new Map();
  private pending: Map<string, PendingRequest[]> = new Map();
  private requestCounter = 0;

  constructor(config?: Partial<LockManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `lock_req_${++this.requestCounter}_${Date.now()}`;
  }

  /**
   * 获取读锁
   * 多个读锁可以同时持有
   */
  async acquireRead(resource: string, timeout?: number): Promise<string> {
    return this.acquire(resource, 'read', timeout || this.config.readLockTimeout);
  }

  /**
   * 获取写锁
   * 写锁独占，需要等待所有读写锁释放
   */
  async acquireWrite(resource: string, timeout?: number): Promise<string> {
    return this.acquire(resource, 'write', timeout || this.config.writeLockTimeout);
  }

  /**
   * 获取锁
   */
  private async acquire(
    resource: string,
    type: LockType,
    timeout: number
  ): Promise<string> {
    const requestId = this.generateRequestId();

    // 检查是否可以直接获取锁
    if (this.canAcquire(resource, type)) {
      this.grantLock(resource, requestId, type, timeout);
      return requestId;
    }

    // 需要等待
    return new Promise((resolve, reject) => {
      // 检查等待队列长度
      const pendingList = this.pending.get(resource) || [];
      if (pendingList.length >= this.config.maxPendingRequests) {
        reject(new Error(`Lock queue full for resource: ${resource}`));
        return;
      }

      // 设置超时
      const timer = setTimeout(() => {
        this.removeFromPending(resource, requestId);
        reject(new Error(`Lock acquisition timeout for resource: ${resource}`));
      }, timeout);

      // 添加到等待队列
      const request: PendingRequest = {
        id: requestId,
        type,
        resolve: (released: boolean) => {
          clearTimeout(timer);
          if (released) {
            resolve(requestId);
          } else {
            reject(new Error('Lock request cancelled'));
          }
        },
        reject,
        timeout: timer
      };

      if (!this.pending.has(resource)) {
        this.pending.set(resource, []);
      }
      this.pending.get(resource)!.push(request);
    });
  }

  /**
   * 检查是否可以获取锁
   */
  private canAcquire(resource: string, type: LockType): boolean {
    const holders = this.holders.get(resource) || [];

    if (holders.length === 0) {
      return true;
    }

    if (type === 'read') {
      // 读锁：只有当没有写锁时才能获取
      return !holders.some(h => h.type === 'write');
    } else {
      // 写锁：需要没有其他任何锁
      return false;
    }
  }

  /**
   * 授予锁
   */
  private grantLock(
    resource: string,
    requestId: string,
    type: LockType,
    timeout: number
  ): void {
    const holder: LockHolder = {
      id: requestId,
      type,
      acquiredAt: Date.now(),
      timeout
    };

    if (!this.holders.has(resource)) {
      this.holders.set(resource, []);
    }
    this.holders.get(resource)!.push(holder);
  }

  /**
   * 释放锁
   */
  release(resource: string, requestId: string): void {
    const holders = this.holders.get(resource);
    if (!holders) return;

    // 移除持有者
    const index = holders.findIndex(h => h.id === requestId);
    if (index !== -1) {
      holders.splice(index, 1);
    }

    // 如果没有持有者了，处理等待队列
    if (holders.length === 0) {
      this.processPending(resource);
    } else if (!holders.some(h => h.type === 'write')) {
      // 如果只有读锁，可以处理等待的读锁请求
      this.processPendingReadLocks(resource);
    }
  }

  /**
   * 处理等待队列
   */
  private processPending(resource: string): void {
    const pendingList = this.pending.get(resource);
    if (!pendingList || pendingList.length === 0) return;

    // 取第一个请求
    const request = pendingList.shift();

    if (request) {
      this.grantLock(resource, request.id, request.type, 60000);
      request.resolve(true);
    }

    // 如果是读锁请求，继续处理其他读锁
    if (request?.type === 'read') {
      this.processPendingReadLocks(resource);
    }
  }

  /**
   * 处理等待中的读锁
   */
  private processPendingReadLocks(resource: string): void {
    const pendingList = this.pending.get(resource);
    if (!pendingList) return;

    const stillPending: PendingRequest[] = [];

    for (const request of pendingList) {
      if (request.type === 'read') {
        this.grantLock(resource, request.id, request.type, 60000);
        request.resolve(true);
      } else {
        stillPending.push(request);
      }
    }

    this.pending.set(resource, stillPending);
  }

  /**
   * 从等待队列移除
   */
  private removeFromPending(resource: string, requestId: string): void {
    const pendingList = this.pending.get(resource);
    if (!pendingList) return;

    const index = pendingList.findIndex(r => r.id === requestId);
    if (index !== -1) {
      const [removed] = pendingList.splice(index, 1);
      clearTimeout(removed.timeout);
    }
  }

  /**
   * 检查资源是否被锁定
   */
  isLocked(resource: string): boolean {
    const holders = this.holders.get(resource);
    return holders !== undefined && holders.length > 0;
  }

  /**
   * 获取资源锁状态
   */
  getLockStatus(resource: string): {
    holders: number;
    pending: number;
    types: LockType[];
  } {
    const holders = this.holders.get(resource) || [];
    const pendingList = this.pending.get(resource) || [];

    return {
      holders: holders.length,
      pending: pendingList.length,
      types: holders.map(h => h.type)
    };
  }

  /**
   * 强制释放所有锁（用于清理）
   */
  forceReleaseAll(resource: string): void {
    // 清除持有者
    this.holders.delete(resource);

    // 拒绝所有等待中的请求
    const pendingList = this.pending.get(resource);
    if (pendingList) {
      for (const request of pendingList) {
        clearTimeout(request.timeout);
        request.reject(new Error('Lock force released'));
      }
      this.pending.delete(resource);
    }
  }

  /**
   * 清理超时的锁
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    Array.from(this.holders.entries()).forEach(([resource, holders]) => {
      const validHolders = holders.filter(h => {
        const expired = h.acquiredAt + h.timeout < now;
        if (expired) cleaned++;
        return !expired;
      });

      if (validHolders.length === 0) {
        this.holders.delete(resource);
        this.processPending(resource);
      } else if (validHolders.length !== holders.length) {
        this.holders.set(resource, validHolders);
      }
    });

    return cleaned;
  }
}

/**
 * 简单的异步锁（单资源）
 */
export class AsyncLock {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * 创建全局锁管理器
 */
export const globalLockManager = new LockManager();
