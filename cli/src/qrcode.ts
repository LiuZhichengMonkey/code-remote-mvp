import chalk from 'chalk';
import qrcode from 'qrcode-terminal';

export interface ConnectionInfo {
  host: string;
  port: number;
  token: string;
  tunnelUrl?: string;
}

export class QRCodeGenerator {
  static display(connectionInfo: ConnectionInfo) {
    const { host, port, token, tunnelUrl } = connectionInfo;

    // Determine which URL to use
    const wsUrl = tunnelUrl
      ? `wss://${tunnelUrl.replace('https://', '').replace('http://', '')}`
      : `ws://${host}:${port}`;

    // Create connection string for QR code
    // Format: code-remote://host:port?token=xxx
    const qrData = `code-remote://${wsUrl.replace('ws://', '').replace('wss://', '')}?token=${token}`;

    console.log();
    console.log(chalk.bold.cyan('📱 Scan QR Code to Connect'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();

    // Generate QR code
    qrcode.generate(qrData, { small: true }, (qrcode) => {
      console.log(qrcode);
    });

    console.log();
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
    console.log(chalk.bold('Or enter manually:'));
    console.log();
    console.log(chalk.cyan('Server URL:'), chalk.white(wsUrl));
    console.log(chalk.cyan('Token:'),     chalk.yellow(token));
    console.log();
    console.log(chalk.gray('─'.repeat(50)));

    // Show manual connection info
    console.log();
    console.log(chalk.yellow('💡 Manual Connection (if scan fails):'));
    console.log();
    console.log(chalk.gray('1. Open CodeRemote app on your phone'));
    console.log(chalk.gray('2. Enter the URL above'));
    console.log(chalk.gray('3. Enter the token above'));
    console.log(chalk.gray('4. Tap Connect'));
    console.log();
  }

  static displayTunnelUrl(url: string) {
    console.log();
    console.log(chalk.green('✓'), `Tunnel Active: ${chalk.cyan(url)}`);
    console.log(chalk.yellow('→'), 'You can now connect from anywhere!');
    console.log();
  }

  static displayInstructions() {
    console.log();
    console.log(chalk.bold.cyan('📲 Getting the App'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
    console.log(chalk.yellow('1. Android:'), 'Install from Google Play (coming soon)');
    console.log(chalk.yellow('2. iOS:'),     'Install from App Store (coming soon)');
    console.log(chalk.yellow('3. Dev:'),     'Build from source: flutter build apk');
    console.log();
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
  }
}
