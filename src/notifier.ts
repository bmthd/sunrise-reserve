import notifier from 'node-notifier';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ROOM_TYPES, FORM_URL } from './constants.js';

const execAsync = promisify(exec);

export type NotificationType = 'sound' | 'discord';

export interface NotificationConfig {
  type: NotificationType;
  discordWebhookUrl?: string;
}

const RESERVATION_URL = FORM_URL;

async function playSound(): Promise<void> {
  try {
    if (process.platform === 'linux') {
      await execAsync('paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || beep -f 1000 -l 500 -r 3 2>/dev/null || echo -e "\\a"');
    } else if (process.platform === 'darwin') {
      await execAsync('afplay /System/Library/Sounds/Glass.aiff');
    } else if (process.platform === 'win32') {
      await execAsync('powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\notify.wav").PlaySync();');
    }
  } catch (error) {
    console.log('\x07\x07\x07');
  }
}

async function sendDiscordWebhook(webhookUrl: string, message: string, url?: string): Promise<void> {
  try {
    const embedDescription = url ? `${message}\n\n**予約URL:**\n${url}` : message;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: url ? `@here ${message}` : message,
        embeds: [{
          title: '🎉 サンライズ 空席通知',
          description: embedDescription,
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
          url: url || undefined
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error(`Discord Webhook送信エラー: ${(error as Error).message}`);
  }
}

async function notifyWithSound(message: string): Promise<void> {
  notifier.notify({
    title: 'サンライズ 空席通知',
    message,
    sound: true,
    wait: false
  });

  await playSound();
}

export async function testDiscordWebhook(webhookUrl: string): Promise<void> {
  console.log('Discord Webhookの動作確認を行います...');
  try {
    await sendDiscordWebhook(webhookUrl, 'テスト通知: サンライズ監視システムが正常に起動しました。');
    console.log('✓ Discord Webhook送信成功\n');
  } catch (error) {
    console.error('✗ Discord Webhook送信失敗:', (error as Error).message);
    console.error('Webhook URLを確認してください。\n');
    throw error;
  }
}

export async function notifyAvailability(
  availableRooms: string[],
  config: NotificationConfig
): Promise<void> {
  const roomNames = availableRooms
    .map(rt => ROOM_TYPES.find(r => r.value === rt)?.name)
    .join(', ');

  const message = `空席が見つかりました！\n${roomNames}`;

  if (config.type === 'discord' && config.discordWebhookUrl) {
    await sendDiscordWebhook(config.discordWebhookUrl, message, RESERVATION_URL);
  } else {
    await notifyWithSound(message);
  }
}

export async function notifyShutdown(
  config: NotificationConfig,
  foundCount: number
): Promise<void> {
  const message = foundCount > 0
    ? `監視を終了しました。\n空席発見回数: ${foundCount}回`
    : '監視を終了しました。\n空席は見つかりませんでした。';

  if (config.type === 'discord' && config.discordWebhookUrl) {
    try {
      const response = await fetch(config.discordWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          embeds: [{
            title: '🛑 監視終了',
            description: message,
            color: foundCount > 0 ? 0x0099ff : 0x999999,
            timestamp: new Date().toISOString()
          }]
        })
      });

      if (!response.ok) {
        console.error('Discord Webhook送信に失敗しました:', response.statusText);
      }
    } catch (error) {
      console.error('Discord Webhook送信エラー:', (error as Error).message);
    }
  } else {
    notifier.notify({
      title: 'サンライズ監視終了',
      message,
      sound: false,
      wait: false
    });
  }
}
