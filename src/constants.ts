export interface Train {
  name: string;
  value: string;
}

export interface RoomType {
  name: string;
  value: string;
}

export const SETTINGS_FILE = './settings.json';
export const CHECK_INTERVAL = 30000; // 30秒

export const TRAINS: Train[] = [
  { name: 'サンライズ瀬戸', value: 'seto' },
  { name: 'サンライズ出雲', value: 'izumo' }
];

export const ROOM_TYPES: RoomType[] = [
  { name: '普通車 ノビノビ座席', value: 'nobinovi' },
  { name: 'A寝台個室 シングルデラックス', value: 'single_deluxe' },
  { name: 'B寝台個室 シングルツイン', value: 'single_twin' },
  { name: 'B寝台個室 シングル', value: 'single' },
  { name: 'B寝台個室 ソロ', value: 'solo' },
  { name: 'B寝台個室 サンライズツイン', value: 'sunrise_twin' }
];

export const ROOM_TYPE_FORM_VALUES: Record<string, string> = {
  nobinovi: '普通車ノビノビ座席',
  single_deluxe: 'シングルデラックス',
  single_twin: 'シングルツイン',
  single: 'シングル',
  solo: 'ソロ',
  sunrise_twin: 'サンライズツイン'
};

export const ROOM_TYPE_KEYWORDS: Record<string, string[]> = {
  nobinovi: ['普通車 ノビノビ座席', '普通車ノビノビ座席', 'ノビノビ座席'],
  single_deluxe: ['A寝台個室 シングルデラックス', 'シングルデラックス', 'シングルデラックス A寝台個室'],
  single_twin: ['B寝台個室 シングルツイン', 'シングルツイン', 'シングルツイン B寝台個室'],
  single: ['B寝台個室 シングル', 'シングル B寝台個室'],
  solo: ['B寝台個室 ソロ', 'ソロ B寝台個室', 'ソロ'],
  sunrise_twin: ['B寝台個室 サンライズツイン', 'サンライズツイン', 'サンライズツイン B寝台個室']
};

export const POSITIVE_KEYWORDS = [
  '空席あり',
  '空席有り',
  '空席があります',
  '空席ございます',
  '空席有',
  '残席あり',
  '残席有り',
  '残席僅か',
  '残席わずか',
  '残りわずか',
  '残り僅か',
  '空席◯',
  '空席○',
  '空席◎',
  '空席△',
  '残席◯',
  '残席○',
  '残席◎',
  '○',
  '◎',
  '◯',
  '△'
];

export const NEGATIVE_KEYWORDS = [
  '空席なし',
  '空席はありません',
  '空席ございません',
  '空席ありません',
  '空席ありませんでした',
  '空席ありませんでした。',
  '空席がありません',
  '空席無し',
  '残席なし',
  '満席',
  '発売終了',
  '販売終了',
  '取扱いできません',
  '取扱できません',
  '受付終了',
  '満了',
  '申込不可',
  '受付不可',
  '×'
];

export const DEPARTURE_STATIONS: string[] = [
  '東京', '横浜', '小田原', '熱海', '沼津', '富士', '静岡', '浜松',
  '姫路', '三ノ宮', '大阪', '京都'
];

export const ARRIVAL_STATIONS: string[] = [
  '東京', '横浜', '小田原', '熱海', '沼津', '富士', '静岡', '浜松',
  '姫路', '三ノ宮', '大阪', '京都', '岡山', '高松', '出雲市'
];

// 東京〜岡山間の共通区間の駅
const COMMON_ROUTE_STATIONS = [
  '東京', '横浜', '小田原', '熱海', '沼津', '富士', '静岡', '浜松',
  '姫路', '三ノ宮', '大阪', '京都', '岡山'
];

// 瀬戸専用の駅（岡山以西）
const SETO_ONLY_STATIONS = ['高松'];

// 出雲専用の駅（岡山以西）
const IZUMO_ONLY_STATIONS = ['出雲市'];

/**
 * 駅のペアから検索対象の列車を判定
 * @returns 'both' | 'seto' | 'izumo'
 */
export function determineTrainsToSearch(departure: string, arrival: string): ('seto' | 'izumo')[] {
  const isCommonDeparture = COMMON_ROUTE_STATIONS.includes(departure);
  const isCommonArrival = COMMON_ROUTE_STATIONS.includes(arrival);

  // 両駅が共通区間の場合は両方検索
  if (isCommonDeparture && isCommonArrival) {
    return ['seto', 'izumo'];
  }

  // 片方または両方が高松の場合は瀬戸のみ
  if (departure === '高松' || arrival === '高松') {
    return ['seto'];
  }

  // 片方または両方が出雲市の場合は出雲のみ
  if (departure === '出雲市' || arrival === '出雲市') {
    return ['izumo'];
  }

  // デフォルトは両方検索
  return ['seto', 'izumo'];
}

export const FORM_URL = 'https://www.jr-odekake.net/goyoyaku/campaign/sunriseseto_izumo/form.html';
