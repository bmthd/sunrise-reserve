import * as p from '@clack/prompts';
import type { Settings } from './availability.js';
import { TRAINS, ROOM_TYPES, DEPARTURE_STATIONS, ARRIVAL_STATIONS } from './constants.js';
import { loadSettings, saveSettings } from './settings.js';

export async function getFormData(savedSettings: Settings | null): Promise<Settings> {
  p.intro('サンライズ瀬戸・出雲 空席監視 設定');

  if (savedSettings) {
    const useSaved = await p.confirm({
      message: '保存された設定を使用しますか？',
      initialValue: true
    });

    if (p.isCancel(useSaved)) {
      p.cancel('設定をキャンセルしました。');
      process.exit(0);
    }

    if (useSaved) {
      p.outro('保存された設定を使用します。');
      return savedSettings;
    }
  }

  const notificationType = await p.select({
    message: '通知方法を選択してください',
    options: [
      { value: 'sound', label: '音声通知' },
      { value: 'discord', label: 'Discord Webhook' }
    ]
  }) as 'sound' | 'discord';

  if (p.isCancel(notificationType)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  let discordWebhookUrl: string | undefined;
  if (notificationType === 'discord') {
    const webhookUrl = await p.text({
      message: 'Discord Webhook URLを入力してください',
      validate: (value) => {
        if (!value) return 'URLを入力してください';
        if (!value.startsWith('https://discord.com/api/webhooks/')) {
          return '有効なDiscord Webhook URLを入力してください';
        }
      }
    });

    if (p.isCancel(webhookUrl)) {
      p.cancel('設定をキャンセルしました。');
      process.exit(0);
    }

    discordWebhookUrl = webhookUrl as string;
  }

  const train = await p.select({
    message: '列車を選択してください',
    options: TRAINS.map(t => ({ value: t.value, label: t.name }))
  }) as string;

  if (p.isCancel(train)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  const departureStation = await p.select({
    message: '乗車駅を選択してください',
    options: DEPARTURE_STATIONS.map(s => ({ value: s, label: s }))
  }) as string;

  if (p.isCancel(departureStation)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  const arrivalStation = await p.select({
    message: '降車駅を選択してください',
    options: ARRIVAL_STATIONS.map(s => ({ value: s, label: s }))
  }) as string;

  if (p.isCancel(arrivalStation)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  const date = await p.text({
    message: '乗車日を入力してください',
    placeholder: '2025-11-15',
    validate: (value) => {
      if (!value) return '日付を入力してください';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return 'YYYY-MM-DD形式で入力してください';
      }
    }
  });

  if (p.isCancel(date)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  const roomTypes = await p.multiselect({
    message: '監視する部屋タイプを選択してください（スペースで選択、Enterで確定）',
    options: ROOM_TYPES.map(r => ({ value: r.value, label: r.name })),
    required: true
  }) as string[];

  if (p.isCancel(roomTypes)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  const settings: Settings = {
    train,
    departureStation,
    arrivalStation,
    date: date as string,
    roomTypes,
    notificationType,
    discordWebhookUrl
  };

  const shouldSave = await p.confirm({
    message: 'この設定を保存しますか？',
    initialValue: true
  });

  if (p.isCancel(shouldSave)) {
    p.cancel('設定をキャンセルしました。');
    process.exit(0);
  }

  if (shouldSave) {
    await saveSettings(settings);
    p.outro('設定を保存しました。');
  } else {
    p.outro('設定完了');
  }

  return settings;
}

export async function showConfig(): Promise<void> {
  p.intro('設定確認');

  const savedSettings = await loadSettings();

  if (savedSettings) {
    p.note(JSON.stringify(savedSettings, null, 2), '現在の設定');

    const shouldChange = await p.confirm({
      message: '設定を変更しますか？',
      initialValue: false
    });

    if (p.isCancel(shouldChange)) {
      p.cancel('キャンセルしました。');
      process.exit(0);
    }

    if (shouldChange) {
      await getFormData(null);
    } else {
      p.outro('設定確認を終了します。');
    }
  } else {
    p.note('設定が見つかりません。新しい設定を作成します。', '通知');
    await getFormData(null);
  }
}
