import { chromium, type Browser, type Page } from 'playwright';
import type { RoomType } from './constants.js';
import {
  ROOM_TYPES,
  ROOM_TYPE_FORM_VALUES,
  ROOM_TYPE_KEYWORDS,
  POSITIVE_KEYWORDS,
  NEGATIVE_KEYWORDS,
  FORM_URL,
  determineTrainsToSearch
} from './constants.js';

export interface Settings {
  departureStation: string;
  arrivalStation: string;
  date: string;
  roomTypes: string[];
  notificationType: 'sound' | 'discord';
  discordWebhookUrl?: string;
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface RoomAvailabilityResult {
  roomType: string;
  roomInfo: RoomType;
  status: AvailabilityStatus;
  indicatorText?: string;
}

export interface AvailabilityCheckResult {
  hasAvailability: boolean;
  availableRooms: string[];
}

const NORMALIZED_POSITIVE_KEYWORDS = POSITIVE_KEYWORDS.map(normalizeForSearch);
const NORMALIZED_NEGATIVE_KEYWORDS = NEGATIVE_KEYWORDS.map(normalizeForSearch);

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）・･\-~〜―‐]/g, '');
}

function getRoomKeywordCandidates(room: RoomType): string[] {
  const aliases = ROOM_TYPE_KEYWORDS[room.value] || [];
  const unique = new Set<string>([room.name, ...aliases]);
  return Array.from(unique);
}

function resolveRoomAvailability(normalizedBody: string, room: RoomType): AvailabilityStatus {
  const candidates = getRoomKeywordCandidates(room).map(normalizeForSearch);

  for (const keyword of candidates) {
    if (!keyword) continue;

    let index = normalizedBody.indexOf(keyword);
    while (index !== -1) {
      const windowStart = Math.max(0, index - 40);
      const windowEnd = Math.min(normalizedBody.length, index + keyword.length + 40);
      const snippet = normalizedBody.slice(windowStart, windowEnd);

      if (NORMALIZED_NEGATIVE_KEYWORDS.some(neg => neg && snippet.includes(neg))) {
        return 'unavailable';
      }

      if (NORMALIZED_POSITIVE_KEYWORDS.some(pos => pos && snippet.includes(pos))) {
        return 'available';
      }

      index = normalizedBody.indexOf(keyword, index + keyword.length);
    }
  }

  return 'unknown';
}

function classifyAvailabilityText(text: string): AvailabilityStatus {
  if (!text) return 'unknown';
  const normalized = normalizeForSearch(text);
  if (!normalized) return 'unknown';

  if (NORMALIZED_NEGATIVE_KEYWORDS.some(neg => neg && normalized.includes(neg))) {
    return 'unavailable';
  }

  if (NORMALIZED_POSITIVE_KEYWORDS.some(pos => pos && normalized.includes(pos))) {
    return 'available';
  }

  return 'unknown';
}

async function resolveRoomAvailabilityFromIcons(page: Page, room: RoomType): Promise<{ status: AvailabilityStatus; indicator?: string }> {
  const formValue = ROOM_TYPE_FORM_VALUES[room.value];
  if (!formValue) {
    return { status: 'unknown' };
  }

  const radioLocator = page.locator(`input[type="radio"][name="facilitySelect"][value="${formValue}"]`);
  if ((await radioLocator.count()) === 0) {
    return { status: 'unknown' };
  }

  const containerLocator = radioLocator.locator('xpath=ancestor::tr[1]');
  const iconCandidates = containerLocator.locator('img[alt]');

  let indicatorText: string | undefined;

  if ((await iconCandidates.count()) > 0) {
    const allAlts = await iconCandidates.evaluateAll(imgs =>
      imgs
        .map(img => img.getAttribute('alt')?.trim() ?? '')
        .filter(Boolean)
    );

    indicatorText = allAlts.find(alt => classifyAvailabilityText(alt) !== 'unknown');
  }

  if (!indicatorText) {
    const fallbackIcons = radioLocator.locator('xpath=following::img[alt][1]');
    if ((await fallbackIcons.count()) > 0) {
      const alt = (await fallbackIcons.first().getAttribute('alt'))?.trim();
      if (alt && classifyAvailabilityText(alt) !== 'unknown') {
        indicatorText = alt;
      }
    }
  }

  if (!indicatorText) {
    return { status: 'unknown' };
  }

  return { status: classifyAvailabilityText(indicatorText), indicator: indicatorText };
}

export async function checkAvailability(settings: Settings, maxRetries: number = 3): Promise<AvailabilityCheckResult> {
  let browser: Browser | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`\n[${new Date().toLocaleString('ja-JP')}] チェック中...${attempt > 1 ? ` (再試行 ${attempt}/${maxRetries})` : ''}`);

      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page: Page = await context.newPage();

      await page.goto(FORM_URL, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await page.waitForTimeout(2000);

      const availabilityHtml = await page.content();

      if (!availabilityHtml) {
        throw new Error('ページの読み込みに失敗しました');
      }

      const normalizedBody = normalizeForSearch(availabilityHtml);

      const roomStatuses: RoomAvailabilityResult[] = [];

      for (const roomType of settings.roomTypes) {
        const roomInfo = ROOM_TYPES.find(r => r.value === roomType);
        if (!roomInfo) {
          console.warn(`未定義の部屋タイプです: ${roomType}`);
          continue;
        }

        const iconResult = await resolveRoomAvailabilityFromIcons(page, roomInfo);
        let status = iconResult.status;

        if (status === 'unknown') {
          status = resolveRoomAvailability(normalizedBody, roomInfo);
        }

        roomStatuses.push({
          roomType,
          roomInfo,
          status,
          indicatorText: iconResult.indicator
        });
      }

      if (roomStatuses.length > 0) {
        console.log('\n空席判定結果:');
        roomStatuses.forEach(({ roomInfo, status, indicatorText }) => {
          const statusLabel =
            status === 'available'
              ? '○ 空席あり'
              : status === 'unavailable'
                ? '× 空席なし'
                : '- 判定不可';
          console.log(
            `  - ${roomInfo.name}: ${statusLabel}` +
            (indicatorText ? ` (判定根拠: ${indicatorText})` : '')
          );
        });
      }

      const availableRooms = roomStatuses
        .filter(({ status }) => status === 'available')
        .map(({ roomType }) => roomType);

      if (availableRooms.length > 0) {
        const trains = determineTrainsToSearch(settings.departureStation, settings.arrivalStation);
        const trainNames = trains.map(t => t === 'seto' ? 'サンライズ瀬戸' : 'サンライズ出雲').join('・');

        console.log('\n🎉 空席が見つかりました！');
        console.log(`対象列車: ${trainNames}`);
        console.log(`区間: ${settings.departureStation} → ${settings.arrivalStation}`);
        console.log(`日付: ${settings.date}`);
        console.log('空席のある部屋:');
        availableRooms.forEach(roomType => {
          const roomInfo = ROOM_TYPES.find(r => r.value === roomType);
          console.log(`  - ${roomInfo?.name}`);
        });

        await browser.close();
        return { hasAvailability: true, availableRooms };
      } else {
        console.log('\n空席なし');
        await browser.close();
        return { hasAvailability: false, availableRooms: [] };
      }

    } catch (error) {
      lastError = error as Error;
      console.error(`エラーが発生しました (試行 ${attempt}/${maxRetries}):`, lastError.message);

      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('ブラウザのクローズに失敗:', (closeError as Error).message);
        }
      }

      if (attempt < maxRetries) {
        console.log(`${3}秒後に再試行します...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  // すべての再試行が失敗した場合
  console.error('すべての試行が失敗しました。最後のエラー:', lastError?.message);
  return { hasAvailability: false, availableRooms: [] };
}
