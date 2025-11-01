import { Command } from 'commander';
import { checkAvailability } from './src/availability.js';
import { loadSettings } from './src/settings.js';
import { getFormData, showConfig } from './src/cli.js';
import { notifyAvailability, testDiscordWebhook } from './src/notifier.js';
import { CHECK_INTERVAL } from './src/constants.js';

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

  console.log(`\n監視を開始します。${interval / 1000}秒ごとにチェックします。`);
  console.log('終了するには Ctrl+C を押してください。\n');

  // 初回チェック
  const initialResult = await checkAvailability(settings);
  if (initialResult.hasAvailability) {
    await notifyAvailability(initialResult.availableRooms, notificationConfig);
  }

  // 指定間隔でチェック
  const intervalId = setInterval(async () => {
    const result = await checkAvailability(settings);
    if (result.hasAvailability) {
      await notifyAvailability(result.availableRooms, notificationConfig);
      console.log('\n空席が見つかったため、監視を継続します。');
      console.log('予約する場合は Ctrl+C で終了してください。\n');
    }
  }, interval);

  // Ctrl+C でクリーンアップ
  process.on('SIGINT', () => {
    console.log('\n\n監視を終了します。');
    clearInterval(intervalId);
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
