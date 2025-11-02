// JR座席予約システムの空席状況管理
// 実際のJRシステムの表示記号と表現に基づいた実装

import { chromium, type Browser, type Page, type Locator } from 'playwright';
import type { RoomType } from './constants.js';
import {
  ROOM_TYPES,
  ROOM_TYPE_FORM_VALUES,
  ROOM_TYPE_KEYWORDS,
  POSITIVE_KEYWORDS,
  NEGATIVE_KEYWORDS,
  FORM_URL,
  determineTrainsToSearch,
  TRAINS
} from './constants.js';

export enum SeatAvailability {
  AVAILABLE = 'available',      // ○ 空席あり
  LIMITED = 'limited',          // ▲ 残りわずか
  FULL = 'full',               // × 満席
  NO_SERVICE = 'no_service'    // － 運休・設備なし
}

export interface AvailabilityDisplay {
  symbol: string;
  label: string;
  color: string;
  description: string;
}

// JR予約システムの実際の表示記号に基づく設定
export const AVAILABILITY_DISPLAY: Record<SeatAvailability, AvailabilityDisplay> = {
  [SeatAvailability.AVAILABLE]: {
    symbol: '○',
    label: '空席あり',
    color: '#00A0FF',
    description: '予約可能な座席があります'
  },
  [SeatAvailability.LIMITED]: {
    symbol: '▲',
    label: '残りわずか',
    color: '#FF8C00', 
    description: '一定程度座席が発売済みです'
  },
  [SeatAvailability.FULL]: {
    symbol: '×',
    label: '満席',
    color: '#FF0000',
    description: '空席がありません'
  },
  [SeatAvailability.NO_SERVICE]: {
    symbol: '－',
    label: '設備なし',
    color: '#999999',
    description: 'この設備はありません'
  }
};

export interface TrainAvailability {
  trainNumber: string;
  trainName: string;
  departure: string;
  arrival: string;
  date: string;
  roomTypes: RoomAvailability[];
}

export interface RoomAvailability {
  type: string;
  name: string;
  availability: SeatAvailability;
  price?: number;
  indicatorText?: string;
}

// 元のコードとの互換性のため追加するinterface/type
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
  train: 'seto' | 'izumo';
  roomType: string;
  roomInfo: any;
  status: AvailabilityStatus;
  indicatorText?: string;
}

export interface AvailabilityCheckResult {
  hasAvailability: boolean;
  availableRooms: string[];
}

interface RowAnalysisSnapshot {
  iconIndicators: string[];
  attributeIndicators: string[];
  textContent?: string;
}

// 元のコードとの互換性のため、元の関数を仮実装
export function resolveAvailabilityFromSnapshot(snapshot: RowAnalysisSnapshot): any {
  // 新しいロジックでの簡易実装
  const allText = [...snapshot.iconIndicators, ...snapshot.attributeIndicators, snapshot.textContent || ''].join(' ');
  const status = AvailabilityChecker.determineAvailabilityFromText(allText);
  
  return {
    status: status === SeatAvailability.AVAILABLE ? 'available' : 
            status === SeatAvailability.LIMITED ? 'available' : 'unavailable',
    indicator: allText
  };
}

// メイン関数：実際のcheckAvailability関数の実装
export async function checkAvailability(settings: Settings, maxRetries: number = 3): Promise<AvailabilityCheckResult> {

  let browser: Browser | null = null;
  let lastError: Error | null = null;

  const TRAIN_NAME_MAP: Record<'seto' | 'izumo', string> = {
    seto: TRAINS.find(train => train.value === 'seto')?.name ?? 'サンライズ瀬戸',
    izumo: TRAINS.find(train => train.value === 'izumo')?.name ?? 'サンライズ出雲'
  };

  function normalizeForSearch(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[\s\u3000]/g, '')
      .replace(/[()（）・･\-~〜―‐]/g, '');
  }

  function createKeywordEntries(keywords: string[]): { raw: string; normalized: string }[] {
    return keywords
      .map(raw => ({ raw, normalized: normalizeForSearch(raw) }))
      .filter((entry): entry is { raw: string; normalized: string } => Boolean(entry.normalized));
  }

  function findKeywordMatch(normalizedText: string, entries: { raw: string; normalized: string }[]): { raw: string; normalized: string } | null {
    if (!normalizedText) return null;
    for (const entry of entries) {
      if (entry.normalized && normalizedText.includes(entry.normalized)) {
        return entry;
      }
    }
    return null;
  }

  function analyzeTextForAvailability(text: string): { status: AvailabilityStatus; keyword?: string } {
    if (!text) return { status: 'unknown' };

    const normalized = normalizeForSearch(text);
    if (!normalized) return { status: 'unknown' };

    const POSITIVE_KEYWORD_ENTRIES = createKeywordEntries(POSITIVE_KEYWORDS);
    const NEGATIVE_KEYWORD_ENTRIES = createKeywordEntries(NEGATIVE_KEYWORDS);

    const negativeMatch = findKeywordMatch(normalized, NEGATIVE_KEYWORD_ENTRIES);
    if (negativeMatch) {
      return { status: 'unavailable', keyword: negativeMatch.raw };
    }

    const positiveMatch = findKeywordMatch(normalized, POSITIVE_KEYWORD_ENTRIES);
    if (positiveMatch) {
      return { status: 'available', keyword: positiveMatch.raw };
    }

    return { status: 'unknown' };
  }

  async function extractAvailabilityFromRow(rowLocator: Locator): Promise<{ status: AvailabilityStatus; indicator?: string }> {
    if ((await rowLocator.count()) === 0) {
      return { status: 'unknown' };
    }

    const row = rowLocator.first();

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

    for (const indicator of iconIndicators) {
      const analysis = analyzeTextForAvailability(indicator);
      if (analysis.status !== 'unknown') {
        return { status: analysis.status, indicator: analysis.keyword ?? indicator };
      }
    }

    const rowText = (await row.innerText())?.trim();
    if (rowText) {
      const analysis = analyzeTextForAvailability(rowText);
      if (analysis.status !== 'unknown') {
        return { status: analysis.status, indicator: analysis.keyword ?? rowText };
      }
    }

    return { status: 'unknown' };
  }

  async function resolveRoomAvailabilityFromPage(
    page: Page,
    room: any,
    scope?: Locator
  ): Promise<{ status: AvailabilityStatus; indicator?: string }> {
    const formValue = ROOM_TYPE_FORM_VALUES[room.value];
    const searchRoot: Locator | Page = scope ?? page;

    if (formValue) {
      const radioLocator = searchRoot.locator(`input[type="radio"][name="facilitySelect"][value="${formValue}"]`);
      if ((await radioLocator.count()) > 0) {
        const containerLocator = radioLocator.locator('xpath=ancestor::tr[1]');
        const iconResult = await extractAvailabilityFromRow(containerLocator);
        if (iconResult.status !== 'unknown') {
          return iconResult;
        }
      }
    }

    const candidates = ROOM_TYPE_KEYWORDS[room.value] || [room.name];
    for (const candidate of candidates) {
      if (!candidate.trim()) continue;
      const rowLocator = searchRoot.locator('tr', { hasText: candidate });
      const rowResult = await extractAvailabilityFromRow(rowLocator);
      if (rowResult.status !== 'unknown') {
        return rowResult;
      }
    }

    return { status: 'unknown' };
  }

  async function getTrainFormLocator(page: Page, train: 'seto' | 'izumo'): Promise<Locator | null> {
    const trainName = TRAIN_NAME_MAP[train];
    const formLocator = page.locator('form', { hasText: trainName });
    if ((await formLocator.count()) > 0) {
      return formLocator.first();
    }
    return null;
  }

  async function collectRoomStatusesForTrain(
    page: Page,
    roomTypes: string[],
    train: 'seto' | 'izumo',
    scope?: Locator
  ): Promise<RoomAvailabilityResult[]> {
    const roomStatuses: RoomAvailabilityResult[] = [];

    for (const roomType of roomTypes) {
      const roomInfo = ROOM_TYPES.find(r => r.value === roomType);
      if (!roomInfo) {
        console.warn(`[${TRAIN_NAME_MAP[train]}] 未定義の部屋タイプです: ${roomType}`);
        continue;
      }

      const pageResult = await resolveRoomAvailabilityFromPage(page, roomInfo, scope);
      
      roomStatuses.push({
        train,
        roomType,
        roomInfo,
        status: pageResult.status,
        indicatorText: pageResult.indicator
      });
    }

    return roomStatuses;
  }

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

      const trainsToCheck = determineTrainsToSearch(
        settings.departureStation,
        settings.arrivalStation
      );
      const roomStatuses: RoomAvailabilityResult[] = [];

      for (const train of trainsToCheck) {
        let formLocator: Locator | null = null;

        try {
          formLocator = await getTrainFormLocator(page, train);
        } catch (error) {
          console.warn(
            `フォームの取得に失敗しました (${TRAIN_NAME_MAP[train]}): ${(error as Error).message}`
          );
        }

        const statuses = await collectRoomStatusesForTrain(
          page,
          settings.roomTypes,
          train,
          formLocator ?? undefined
        );
        roomStatuses.push(...statuses);
      }

      if (roomStatuses.length > 0) {
        console.log('\n空席判定結果:');
        for (const train of trainsToCheck) {
          const statusesForTrain = roomStatuses.filter(status => status.train === train);
          if (statusesForTrain.length === 0) {
            continue;
          }

          console.log(`- ${TRAIN_NAME_MAP[train]}`);
          statusesForTrain.forEach(({ roomInfo, status, indicatorText }) => {
            const statusLabel = AvailabilityChecker.formatAvailabilityStatus(
              status === 'available' ? SeatAvailability.AVAILABLE :
              status === 'unavailable' ? SeatAvailability.FULL : SeatAvailability.NO_SERVICE
            );
            console.log(
              `    - ${roomInfo.name}: ${statusLabel}` +
              (indicatorText ? ` (判定根拠: ${indicatorText})` : '')
            );
          });
        }
      }

      const availableEntries = roomStatuses.filter(({ status }) => status === 'available');
      const availableRooms = Array.from(new Set(availableEntries.map(({ roomType }) => roomType)));

      if (availableEntries.length > 0) {
        const trainNames = trainsToCheck.map(train => TRAIN_NAME_MAP[train]).join('・');

        console.log('\n🎉 空席が見つかりました！');
        console.log(`対象列車: ${trainNames}`);
        console.log(`区間: ${settings.departureStation} → ${settings.arrivalStation}`);
        console.log(`日付: ${settings.date}`);
        console.log('空席のある部屋:');
        availableEntries.forEach(({ roomInfo, train }) => {
          const trainName = TRAIN_NAME_MAP[train];
          console.log(`  - ${roomInfo.name} (${trainName})`);
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

  console.error('すべての試行が失敗しました。最後のエラー:', lastError?.message);
  return { hasAvailability: false, availableRooms: [] };
}

export class AvailabilityChecker {
  
  static getAvailabilityDisplay(status: SeatAvailability): AvailabilityDisplay {
    return AVAILABILITY_DISPLAY[status];
  }

  static formatAvailabilityText(status: SeatAvailability): string {
    const display = this.getAvailabilityDisplay(status);
    return `${display.symbol} ${display.label}`;
  }

  static isBookable(status: SeatAvailability): boolean {
    return status === SeatAvailability.AVAILABLE || status === SeatAvailability.LIMITED;
  }

  static getSunriseRoomTypes(): string[] {
    return [
      'ノビノビ座席',
      'シングル',
      'シングルツイン', 
      'サンライズツイン',
      'シングルデラックス'
    ];
  }

  // JRシステムの判定キーワードに基づく状態判定
  static determineAvailabilityFromText(text: string): SeatAvailability {
    if (!text) return SeatAvailability.NO_SERVICE;
    
    const normalizedText = text.normalize('NFKC').toLowerCase().replace(/\s/g, '');
    
    // 満席・空席なしの判定
    if (normalizedText.includes('満席') || 
        normalizedText.includes('空席なし') || 
        normalizedText.includes('残席なし') ||
        normalizedText.includes('×')) {
      return SeatAvailability.FULL;
    }
    
    // 残りわずかの判定
    if (normalizedText.includes('残りわずか') || 
        normalizedText.includes('▲') ||
        normalizedText.includes('一定程度')) {
      return SeatAvailability.LIMITED;
    }
    
    // 空席ありの判定
    if (normalizedText.includes('空席あり') || 
        normalizedText.includes('○') ||
        normalizedText.includes('予約可能')) {
      return SeatAvailability.AVAILABLE;
    }
    
    // 設備なし・運休の判定
    if (normalizedText.includes('設備なし') || 
        normalizedText.includes('運休') ||
        normalizedText.includes('－')) {
      return SeatAvailability.NO_SERVICE;
    }
    
    return SeatAvailability.NO_SERVICE;
  }

  static checkAvailability(trainData: any): TrainAvailability {
    const roomTypes: RoomAvailability[] = this.getSunriseRoomTypes().map(roomType => {
      let availability: SeatAvailability = SeatAvailability.NO_SERVICE;
      let indicatorText: string | undefined;
      
      if (trainData && !trainData.cancelled) {
        const roomInfo = trainData[roomType];
        
        if (roomInfo) {
          // 数値による判定
          if (typeof roomInfo.available === 'number') {
            if (roomInfo.available > 10) {
              availability = SeatAvailability.AVAILABLE;
            } else if (roomInfo.available > 0) {
              availability = SeatAvailability.LIMITED;
            } else {
              availability = SeatAvailability.FULL;
            }
          }
          
          // テキストによる判定（数値情報がない場合）
          if (roomInfo.status && typeof roomInfo.status === 'string') {
            availability = this.determineAvailabilityFromText(roomInfo.status);
            indicatorText = roomInfo.status;
          }
        }
      }

      return {
        type: roomType,
        name: roomType,
        availability,
        price: trainData?.[roomType]?.price,
        indicatorText
      };
    });

    return {
      trainNumber: trainData?.trainNumber || '',
      trainName: trainData?.trainName || '',
      departure: trainData?.departure || '',
      arrival: trainData?.arrival || '',
      date: trainData?.date || new Date().toISOString().split('T')[0],
      roomTypes
    };
  }

  static formatForDisplay(trainAvailability: TrainAvailability): string {
    const header = `${trainAvailability.trainName} (${trainAvailability.trainNumber})`;
    const route = `${trainAvailability.departure} → ${trainAvailability.arrival}`;
    const date = `運行日: ${trainAvailability.date}`;
    
    const roomStatus = trainAvailability.roomTypes
      .map(room => {
        const statusText = this.formatAvailabilityText(room.availability);
        const indicator = room.indicatorText ? ` (${room.indicatorText})` : '';
        return `${room.name}: ${statusText}${indicator}`;
      })
      .join('\n');

    return `${header}\n${route}\n${date}\n\n${roomStatus}`;
  }

  static hasAvailableSeats(trainAvailability: TrainAvailability): boolean {
    return trainAvailability.roomTypes.some(room => this.isBookable(room.availability));
  }

  static getAvailableRoomTypes(trainAvailability: TrainAvailability): RoomAvailability[] {
    return trainAvailability.roomTypes.filter(room => this.isBookable(room.availability));
  }

  static formatAvailabilityStatus(status: SeatAvailability): string {
    switch (status) {
      case SeatAvailability.AVAILABLE:
        return '○ 空席あり';
      case SeatAvailability.LIMITED:
        return '▲ 残りわずか';
      case SeatAvailability.FULL:
        return '× 満席';
      case SeatAvailability.NO_SERVICE:
        return '－ 設備なし';
      default:
        return '- 判定不可';
    }
  }

  // スマートEXやえきねっとの表示形式に合わせた統一的な空席表示
  static getUnifiedAvailabilitySymbol(status: SeatAvailability): string {
    return AVAILABILITY_DISPLAY[status].symbol;
  }

  static getAvailabilityColor(status: SeatAvailability): string {
    return AVAILABILITY_DISPLAY[status].color;
  }
}