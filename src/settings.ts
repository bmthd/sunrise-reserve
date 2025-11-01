import fs from 'fs/promises';
import type { Settings } from './availability.js';
import { SETTINGS_FILE } from './constants.js';

export async function loadSettings(): Promise<Settings | null> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
