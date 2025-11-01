import { Command } from 'commander';
import { checkAvailability } from './src/availability.js';
import { loadSettings } from './src/settings.js';
import { getFormData, showConfig } from './src/cli.js';
import { notifyAvailability, testDiscordWebhook, notifyShutdown } from './src/notifier.js';
import { CHECK_INTERVAL } from './src/constants.js';

function getNextShutdownTime(): Date {
  const now = new Date();
  const shutdown = new Date();

  // 日本時間1:50に設定
  shutdown.setHours(1, 50, 0, 0);

  // 現在時刻が1:50を過ぎていたら翌日の1:50に設定
  if (now >= shutdown) {
    shutdown.setDate(shutdown.getDate() + 1);
  }

  return shutdown;
}

function isMaintenanceTime(): boolean {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // 23:50～翌0:05はメンテナンス時間
  if (hours === 23 && minutes >= 50) {
    return true;
  }
  if (hours === 0 && minutes <= 5) {
    return true;
  }

  return false;
}

function getNextMaintenanceEnd(): Date | null {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // メンテナンス時間中の場合、次の0:05を返す
  if (hours === 23 && minutes >= 50) {
    const end = new Date(now);
    end.setHours(0, 5, 0, 0);
    end.setDate(end.getDate() + 1);
    return end;
  }
  if (hours === 0 && minutes <= 5) {
    const end = new Date(now);
    end.setHours(0, 5, 0, 0);
    return end;
  }

  return null;
}

async function startMonitoring(options: { interval?: number } = {}): Promise<void> {
  console.log('='.repeat(50));
  console.log('サンライズ瀬戸・出雲 空席監視システム');
  console.log('='.repeat(50));

  const savedSettings = await loadSettings();
  const settings = await getFormData(savedSettings);

  const interval = options.interval || CHECK_INTERVAL;

  const notificationConfig = {
    type: settings.notificationType,
    discordWebhookUrl: settings.discordWebhookUrl
  };

  // Discord Webhookの動作確認
  if (settings.notificationType === 'discord' && settings.discordWebhookUrl) {
    try {
      await testDiscordWebhook(settings.discordWebhookUrl);
    } catch (error) {
      console.error('Discord Webhookのテストに失敗しました。監視を開始できません。');
      process.exit(1);
    }
  }

  const shutdownTime = getNextShutdownTime();
  console.log(`\n監視を開始します。${interval / 1000}秒ごとにチェックします。`);
  console.log(`自動終了時刻: ${shutdownTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log('終了するには Ctrl+C を押してください。\n');

  let foundCount = 0;
  let maintenanceTimer: NodeJS.Timeout | null = null;

  // 自動終了タイマー
  const timeUntilShutdown = shutdownTime.getTime() - Date.now();
  const shutdownTimer = setTimeout(async () => {
    console.log('\n\n自動終了時刻になりました。');
    clearInterval(intervalId);
    if (maintenanceTimer) clearTimeout(maintenanceTimer);
    await notifyShutdown(notificationConfig, foundCount);
    process.exit(0);
  }, timeUntilShutdown);

  // チェック実行関数
  const performCheck = async () => {
    // メンテナンス時間かチェック
    if (isMaintenanceTime()) {
      const maintenanceEnd = getNextMaintenanceEnd();
      if (maintenanceEnd) {
        const waitTime = maintenanceEnd.getTime() - Date.now();
        console.log(`\nメンテナンス時間中です (23:50～0:05)`);
        console.log(`再開時刻: ${maintenanceEnd.toLocaleTimeString('ja-JP')}`);

        maintenanceTimer = setTimeout(() => {
          console.log('\nメンテナンス終了。監視を再開します。');
          maintenanceTimer = null;
        }, waitTime);

        return;
      }
    }

    const result = await checkAvailability(settings);
    if (result.hasAvailability) {
      foundCount++;
      await notifyAvailability(result.availableRooms, notificationConfig);
      console.log('\n空席が見つかったため、監視を継続します。');
      console.log('予約する場合は Ctrl+C で終了してください。\n');
    }
  };

  // 初回チェック
  if (!isMaintenanceTime()) {
    await performCheck();
  } else {
    console.log('\n現在メンテナンス時間中です (23:50～0:05)。メンテナンス終了後に監視を開始します。');
    const maintenanceEnd = getNextMaintenanceEnd();
    if (maintenanceEnd) {
      console.log(`再開時刻: ${maintenanceEnd.toLocaleTimeString('ja-JP')}\n`);
    }
  }

  // 指定間隔でチェック
  const intervalId = setInterval(performCheck, interval);

  // Ctrl+C でクリーンアップ
  process.on('SIGINT', async () => {
    console.log('\n\n監視を終了します。');
    clearInterval(intervalId);
    clearTimeout(shutdownTimer);
    if (maintenanceTimer) clearTimeout(maintenanceTimer);
    await notifyShutdown(notificationConfig, foundCount);
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('sunrise-reserve')
    .description('サンライズ瀬戸・出雲の空席状況監視CLI')
    .version('1.0.0');

  program
    .command('start')
    .description('空席監視を開始します')
    .option('-i, --interval <seconds>', 'チェック間隔（秒）', '30')
    .action(async (options) => {
      const interval = parseInt(options.interval) * 1000;
      await startMonitoring({ interval });
    });

  program
    .command('config')
    .description('設定を確認・編集します')
    .action(async () => {
      await showConfig();
    });

  // デフォルトコマンド（引数なしで実行した場合）
  if (process.argv.length === 2) {
    await startMonitoring();
  } else {
    await program.parseAsync(process.argv);
  }
}

main().catch(console.error);
