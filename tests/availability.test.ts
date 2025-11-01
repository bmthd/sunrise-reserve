import { describe, expect, it } from 'bun:test';
import { resolveAvailabilityFromSnapshot } from '../src/availability.js';

describe('icon-based availability detection snapshot', () => {
  it('treats any non "残席なし" icon as available', () => {
    const result = resolveAvailabilityFromSnapshot({
      iconIndicators: ['残席なし', '残席あり'],
      attributeIndicators: [],
      textContent: '残席ありのテスト'
    });

    expect(result.status).toBe('available');
    expect(result.indicator).toBe('残席あり');
  });

  it('returns unavailable when only no-seat icons are present', () => {
    const result = resolveAvailabilityFromSnapshot({
      iconIndicators: ['残席なし', '満席'],
      attributeIndicators: [],
      textContent: '満席です'
    });

    expect(result.status).toBe('unavailable');
    expect(result.indicator).toBe('残席なし');
  });

  it('falls back to descriptive text when icons are missing', () => {
    const result = resolveAvailabilityFromSnapshot({
      iconIndicators: [],
      attributeIndicators: ['空席があります'],
      textContent: '空席があります'
    });

    expect(result.status).toBe('available');
  });

  it('uses aria-label or title indicators when available', () => {
    const result = resolveAvailabilityFromSnapshot({
      iconIndicators: [],
      attributeIndicators: ['空席わずか'],
      textContent: '空席わずか'
    });

    expect(result.status).toBe('available');
    expect(result.indicator).toBe('空席わずか');
  });

  it('returns unknown when no signals are detected', () => {
    const result = resolveAvailabilityFromSnapshot({
      iconIndicators: [],
      attributeIndicators: [],
      textContent: ''
    });

    expect(result.status).toBe('unknown');
  });
});
