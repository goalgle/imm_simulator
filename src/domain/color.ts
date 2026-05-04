// 색상 변환 유틸. Phaser 의존 없음.
// DNA 의 색상은 HSL 로 저장 (활성화/약화 보간이 자연스러움).
// Phaser fillStyle 은 0xRRGGBB 정수를 받으므로 변환 함수가 필요.

// 게임: HSL → 0xRRGGBB 정수.
//   h: 0~360 (hue, 도 단위)
//   s: 0~100 (saturation, 퍼센트)
//   l: 0~100 (lightness, 퍼센트)
// 표준 HSL→RGB 알고리즘 (CSS Color Module 4 정의 기준).
export function hslToRgbInt(h: number, s: number, l: number): number {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    return lN - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = Math.round(channel(0) * 255);
  const g = Math.round(channel(8) * 255);
  const b = Math.round(channel(4) * 255);
  return (r << 16) | (g << 8) | b;
}
