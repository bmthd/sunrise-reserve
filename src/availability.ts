import { chromium, type Browser, type Page, type Locator } from 'playwright';
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

interface KeywordEntry {
  raw: string;
  normalized: string;
}

export interface AvailabilityResolution {
  status: AvailabilityStatus;
  indicator?: string;
}

const POSITIVE_KEYWORD_ENTRIES = createKeywordEntries(POSITIVE_KEYWORDS);
const NEGATIVE_KEYWORD_ENTRIES = createKeywordEntries(NEGATIVE_KEYWORDS);

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）・･\-~〜―‐]/g, '');
}

function createNormalizedSet(keywords: string[]): Set<string> {
  return new Set(keywords.map(normalizeForSearch).filter(Boolean));
}

function createKeywordEntries(keywords: string[]): KeywordEntry[] {
  return keywords
    .map(raw => ({ raw, normalized: normalizeForSearch(raw) }))
    .filter((entry): entry is KeywordEntry => Boolean(entry.normalized));
}

function findKeywordMatch(normalizedText: string, entries: KeywordEntry[]): KeywordEntry | null {
  if (!normalizedText) return null;
  for (const entry of entries) {
    if (entry.normalized && normalizedText.includes(entry.normalized)) {
      return entry;
    }
  }
  return null;
}

function analyzeNormalizedText(normalizedText: string): { status: AvailabilityStatus; keyword?: string } {
  if (!normalizedText) {
    return { status: 'unknown' };
  }

  const negativeMatch = findKeywordMatch(normalizedText, NEGATIVE_KEYWORD_ENTRIES);
  if (negativeMatch) {
    return { status: 'unavailable', keyword: negativeMatch.raw };
  }

  const positiveMatch = findKeywordMatch(normalizedText, POSITIVE_KEYWORD_ENTRIES);
  if (positiveMatch) {
    return { status: 'available', keyword: positiveMatch.raw };
  }

  return { status: 'unknown' };
}

function analyzeTextForAvailability(text: string): { status: AvailabilityStatus; keyword?: string } {
  if (!text) {
    return { status: 'unknown' };
  }

  const normalized = normalizeForSearch(text);
  if (!normalized) {
    return { status: 'unknown' };
  }

  return analyzeNormalizedText(normalized);
}

function getRoomKeywordCandidates(room: RoomType): string[] {
  const aliases = ROOM_TYPE_KEYWORDS[room.value] || [];
  const unique = new Set<string>([room.name, ...aliases]);
  return Array.from(unique);
}

function resolveRoomAvailabilityFromHtml(normalizedBody: string, room: RoomType): AvailabilityResolution {
  const candidates = getRoomKeywordCandidates(room).map(normalizeForSearch);

  for (const keyword of candidates) {
    if (!keyword) continue;

    let index = normalizedBody.indexOf(keyword);
    while (index !== -1) {
      const windowStart = Math.max(0, index - 160);
      const windowEnd = Math.min(normalizedBody.length, index + keyword.length + 160);
      const snippet = normalizedBody.slice(windowStart, windowEnd);
      const analysis = analyzeNormalizedText(snippet);

      if (analysis.status !== 'unknown') {
        return { status: analysis.status, indicator: analysis.keyword };
      }

      index = normalizedBody.indexOf(keyword, index + keyword.length);
    }
  }

  return { status: 'unknown' };
}

const NEGATIVE_ICON_TEXTS = createNormalizedSet(['残席なし', '空席なし', '満席']);

function isNegativeIconIndicator(indicator: string): boolean {
  const normalized = normalizeForSearch(indicator);
  if (!normalized) return false;
  for (const negative of NEGATIVE_ICON_TEXTS) {
    if (normalized.includes(negative)) {
      return true;
    }
  }
  return false;
}

interface RowAnalysisSnapshot {
  iconIndicators: string[];
  attributeIndicators: string[];
  textContent?: string;
}

export function resolveAvailabilityFromSnapshot(snapshot: RowAnalysisSnapshot): AvailabilityResolution {
  const { iconIndicators, attributeIndicators, textContent } = snapshot;

  let negativeIndicator: string | undefined;
  for (const indicator of iconIndicators) {
    if (isNegativeIconIndicator(indicator)) {
      if (!negativeIndicator) {
        negativeIndicator = indicator;
      }
      continue;
    }

    return { status: 'available', indicator };
  }

  if (negativeIndicator) {
    return { status: 'unavailable', indicator: negativeIndicator };
  }

  for (const indicator of attributeIndicators) {
    const analysis = analyzeTextForAvailability(indicator);
    if (analysis.status !== 'unknown') {
      return { status: analysis.status, indicator: analysis.keyword ?? indicator };
    }
  }

  if (textContent) {
    const analysis = analyzeTextForAvailability(textContent);
    if (analysis.status !== 'unknown') {
      return { status: analysis.status, indicator: analysis.keyword ?? textContent };
    }
  }

  return { status: 'unknown' };
}

function selectRowTexts(node: unknown): string[] {
  const element = node as {
    querySelectorAll: (selector: string) => Iterable<{ tagName: string; getAttribute(name: string): string | null }>;
  };
  const texts = new Set<string>();
  for (const child of element.querySelectorAll('[alt],[aria-label],[title]')) {
    if (child.tagName === 'IMG') {
      continue;
    }
    const value =
      child.getAttribute('alt') ||
      child.getAttribute('aria-label') ||
      child.getAttribute('title');
    if (value) {
      const trimmed = value.trim();
      if (trimmed) {
        texts.add(trimmed);
      }
    }
  }
  return Array.from(texts);
}

async function analyzeAvailabilityFromRow(row: Locator): Promise<AvailabilityResolution> {
  const iconIndicators = await row.locator('td img').evaluateAll(images =>
    images
      .map(image => {
        const alt = image.getAttribute('alt')?.trim();
        const ariaLabel = image.getAttribute('aria-label')?.trim();
        const title = image.getAttribute('title')?.trim();
        return alt || ariaLabel || title || '';
      })
      .filter((value): value is string => Boolean(value))
  );

  const attributeIndicators = await row.evaluate((node) => selectRowTexts(node));

  const rowText = (await row.innerText())?.trim();
  return resolveAvailabilityFromSnapshot({
    iconIndicators,
    attributeIndicators,
    textContent: rowText
  });
}

export function selectBestAvailabilityResolution(resolutions: AvailabilityResolution[]): AvailabilityResolution {
  let unavailableResolution: AvailabilityResolution | null = null;
  let unknownResolution: AvailabilityResolution | null = null;

  for (const resolution of resolutions) {
    if (resolution.status === 'available') {
      return resolution;
    }

    if (resolution.status === 'unavailable' && !unavailableResolution) {
      unavailableResolution = resolution;
      continue;
    }

    if (resolution.status === 'unknown' && !unknownResolution) {
      unknownResolution = resolution;
    }
  }

  return unavailableResolution ?? unknownResolution ?? { status: 'unknown' };
}

export async function extractAvailabilityFromRow(rowLocator: Locator): Promise<AvailabilityResolution> {
  const count = await rowLocator.count();
  if (count === 0) {
    return { status: 'unknown' };
  }

  const resolutions: AvailabilityResolution[] = [];

  for (let index = 0; index < count; index++) {
    const row = rowLocator.nth(index);
    const resolution = await analyzeAvailabilityFromRow(row);
    resolutions.push(resolution);
  }

  return selectBestAvailabilityResolution(resolutions);
}

async function resolveRoomAvailabilityFromPage(page: Page, room: RoomType): Promise<AvailabilityResolution> {
  const formValue = ROOM_TYPE_FORM_VALUES[room.value];

  if (formValue) {
    const radioLocator = page.locator(`input[type="radio"][name="facilitySelect"][value="${formValue}"]`);
    if ((await radioLocator.count()) > 0) {
      const containerLocator = radioLocator.locator('xpath=ancestor::tr[1]');
      const iconResult = await extractAvailabilityFromRow(containerLocator);
      if (iconResult.status !== 'unknown') {
        return iconResult;
      }

      const fallbackIcons = radioLocator.locator('xpath=following::img[alt][1]');
      if ((await fallbackIcons.count()) > 0) {
        const alt = (await fallbackIcons.first().getAttribute('alt'))?.trim();
        if (alt) {
          const analysis = analyzeTextForAvailability(alt);
          if (analysis.status !== 'unknown') {
            return { status: analysis.status, indicator: alt };
          }
        }
      }
    }
  }

  const candidates = getRoomKeywordCandidates(room);
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    const rowLocator = page.locator('tr', { hasText: candidate });
    const rowResult = await extractAvailabilityFromRow(rowLocator);
    if (rowResult.status !== 'unknown') {
      return rowResult;
    }
  }

  return { status: 'unknown' };
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

        const pageResult = await resolveRoomAvailabilityFromPage(page, roomInfo);
        let status = pageResult.status;
        let indicatorText = pageResult.indicator;

        if (status === 'unknown') {
          const fallbackResult = resolveRoomAvailabilityFromHtml(normalizedBody, roomInfo);
          status = fallbackResult.status;
          if (!indicatorText && fallbackResult.indicator) {
            indicatorText = fallbackResult.indicator;
          }
        }

        roomStatuses.push({
          roomType,
          roomInfo,
          status,
          indicatorText
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
