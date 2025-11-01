import readline from 'readline';
import type { Settings } from './availability.js';
import { TRAINS, ROOM_TYPES, DEPARTURE_STATIONS, ARRIVAL_STATIONS } from './constants.js';
import { loadSettings, saveSettings } from './settings.js';

type SelectOption = string | { name: string; value: string };

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function selectFromList(
  rl: readline.Interface,
  items: SelectOption[],
  prompt: string
): Promise<string> {
  console.log(`\n${prompt}`);
  items.forEach((item, index) => {
    const label = typeof item === 'string' ? item : item.name;
    console.log(`${index + 1}. ${label}`);
  });

  while (true) {
    const answer = await question(rl, '\n番号を選択してください: ');
    const index = parseInt(answer) - 1;

    if (index >= 0 && index < items.length) {
      const selected = items[index];
      return typeof selected === 'string' ? selected : selected.value;
    }
    console.log('無効な番号です。もう一度入力してください。');
  }
}

async function selectMultipleFromList(
  rl: readline.Interface,
  items: SelectOption[],
  prompt: string
): Promise<string[]> {
  console.log(`\n${prompt}`);
  items.forEach((item, index) => {
    const label = typeof item === 'string' ? item : item.name;
    console.log(`${index + 1}. ${label}`);
  });

  const selected: string[] = [];

  while (true) {
    const answer = await question(
      rl,
      '\n番号を選択してください (複数選択可、カンマ区切り。完了したら空Enter): '
    );

    if (answer.trim() === '') {
      if (selected.length === 0) {
        console.log('最低1つは選択してください。');
        continue;
      }
      break;
    }

    const indices = answer.split(',').map(s => parseInt(s.trim()) - 1);
    let allValid = true;

    for (const index of indices) {
      if (index < 0 || index >= items.length) {
        console.log(`無効な番号があります: ${index + 1}`);
        allValid = false;
        break;
      }

      const choice = items[index];
      const value = typeof choice === 'string' ? choice : choice.value;
      if (!selected.includes(value)) {
        selected.push(value);
      }
    }

    if (allValid && selected.length > 0) {
      console.log('\n現在選択中:');
      selected.forEach(s => {
        const item = items.find(option => {
          if (typeof option === 'string') {
            return option === s;
          }
          return option.value === s;
        });
        const label = typeof item === 'string'
          ? item
          : item?.name ?? s;
        console.log(`  - ${label}`);
      });
      console.log('\n追加選択するか、空Enterで確定してください。');
    }
  }

  return selected;
}

export async function getFormData(savedSettings: Settings | null): Promise<Settings> {
  const rl = createInterface();

  try {
    if (savedSettings) {
      console.log('\n保存された設定:');
      console.log(JSON.stringify(savedSettings, null, 2));
      const use = await question(rl, '\n保存された設定を使用しますか？ (y/n): ');
      if (use.toLowerCase() === 'y') {
        return savedSettings;
      }
    }

    const notificationTypes = [
      { name: '音声通知', value: 'sound' },
      { name: 'Discord Webhook', value: 'discord' }
    ];

    const notificationType = await selectFromList(rl, notificationTypes, '通知方法を選択してください:') as 'sound' | 'discord';

    let discordWebhookUrl: string | undefined;
    if (notificationType === 'discord') {
      discordWebhookUrl = await question(rl, '\nDiscord Webhook URLを入力してください: ');
    }

    const settings: Settings = {
      train: await selectFromList(rl, TRAINS, '列車を選択してください:'),
      departureStation: await selectFromList(rl, DEPARTURE_STATIONS, '乗車駅を選択してください:'),
      arrivalStation: await selectFromList(rl, ARRIVAL_STATIONS, '降車駅を選択してください:'),
      date: await question(rl, '\n乗車日を入力してください (例: 2025-11-15): '),
      roomTypes: await selectMultipleFromList(rl, ROOM_TYPES, '監視する部屋タイプを選択してください:'),
      notificationType,
      discordWebhookUrl
    };

    const save = await question(rl, '\nこの設定を保存しますか？ (y/n): ');
    if (save.toLowerCase() === 'y') {
      await saveSettings(settings);
      console.log('設定を保存しました。');
    }

    return settings;
  } finally {
    rl.close();
  }
}

export async function showConfig(): Promise<void> {
  const rl = createInterface();

  try {
    const savedSettings = await loadSettings();

    if (savedSettings) {
      console.log('\n現在の設定:');
      console.log(JSON.stringify(savedSettings, null, 2));
      console.log('\n');

      const reset = await question(rl, '設定を変更しますか？ (y/n): ');
      if (reset.toLowerCase() === 'y') {
        await getFormData(null);
        console.log('\n設定を更新しました。');
      }
    } else {
      console.log('\n設定が見つかりません。新しい設定を作成します。\n');
      await getFormData(null);
    }
  } finally {
    rl.close();
  }
}
