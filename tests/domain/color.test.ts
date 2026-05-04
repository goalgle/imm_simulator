import { describe, it, expect } from 'vitest';
import { hslToRgbInt } from '../../src/domain/color';

describe('hslToRgbInt', () => {
  it('순수 빨강: h=0, s=100, l=50 → 0xFF0000', () => {
    expect(hslToRgbInt(0, 100, 50)).toBe(0xff0000);
  });

  it('순수 초록: h=120, s=100, l=50 → 0x00FF00', () => {
    expect(hslToRgbInt(120, 100, 50)).toBe(0x00ff00);
  });

  it('순수 파랑: h=240, s=100, l=50 → 0x0000FF', () => {
    expect(hslToRgbInt(240, 100, 50)).toBe(0x0000ff);
  });

  it('흰색: l=100 → 0xFFFFFF (hue/sat 무관)', () => {
    expect(hslToRgbInt(0, 0, 100)).toBe(0xffffff);
    expect(hslToRgbInt(180, 50, 100)).toBe(0xffffff);
  });

  it('검정: l=0 → 0x000000', () => {
    expect(hslToRgbInt(0, 0, 0)).toBe(0x000000);
  });

  it('호중구 색 #E8B4D4 근사: h=322, s=53, l=81', () => {
    const c = hslToRgbInt(322, 53, 81);
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    // 게임: HSL → RGB 변환은 정수 라운딩 오차가 있으므로 ±2 허용.
    expect(r).toBeGreaterThanOrEqual(0xe8 - 2);
    expect(r).toBeLessThanOrEqual(0xe8 + 2);
    expect(g).toBeGreaterThanOrEqual(0xb4 - 4);
    expect(g).toBeLessThanOrEqual(0xb4 + 4);
    expect(b).toBeGreaterThanOrEqual(0xd4 - 4);
    expect(b).toBeLessThanOrEqual(0xd4 + 4);
  });
});
