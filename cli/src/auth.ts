import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

export interface AuthInfo {
  token: string;
  expiresAt?: Date;
}

export class AuthManager {
  private token: string;
  private expiresAt: Date | null = null;

  constructor(token?: string, ttl?: number) {
    this.token = token || uuidv4();

    if (ttl) {
      this.expiresAt = new Date(Date.now() + ttl * 1000);
    }
  }

  getToken(): string {
    return this.token;
  }

  isValid(inputToken: string): boolean {
    if (this.expiresAt && new Date() > this.expiresAt) {
      return false;
    }
    return inputToken === this.token;
  }

  isExpired(): boolean {
    return this.expiresAt !== null && new Date() > this.expiresAt;
  }

  getExpiresAt(): Date | null {
    return this.expiresAt;
  }

  displayInfo() {
    console.log(chalk.gray('-'.repeat(50)));
    console.log(chalk.bold('Authentication Info'));
    console.log(chalk.gray('-'.repeat(50)));
    console.log(`Token:      ${chalk.yellow(this.token)}`);
    if (this.expiresAt) {
      const timeLeft = Math.max(0, this.expiresAt.getTime() - Date.now());
      const minutesLeft = Math.floor(timeLeft / 60000);
      console.log(`Expires:    ${chalk.cyan(this.expiresAt.toLocaleString())}`);
      console.log(`Time Left:  ${chalk.cyan(minutesLeft)} minutes`);
    } else {
      console.log(`Expires:    ${chalk.green('Never')}`);
    }
    console.log(chalk.gray('-'.repeat(50)));
  }

  refresh() {
    this.token = uuidv4();
    if (this.expiresAt) {
      // Keep the same TTL from now
      const ttl = this.expiresAt.getTime() - Date.now();
      this.expiresAt = new Date(Date.now() + ttl);
    }
  }
}
