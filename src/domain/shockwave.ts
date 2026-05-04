// 충격파(Shockwave) 도메인.
// 클릭/탭으로 발생하는 파동이 세포에 가하는 임펄스를 정의.
// 시스템 구현 기획서 §2.2 "관전형 + 결정적 개입" 의 첫 번째 메커닉.
//
// 이 파일은 Phaser 의존 없음 (단위 테스트 가능).

// 게임: 파동의 원시 데이터.
//   x, y       : 발생 위치
//   startTime  : 발생 시각 (초)
//   speed      : 전파 속도 (px/s) — 반경 = age * speed
//   duration   : 지속 시간 (초). 이 시간이 지나면 사라짐.
//   power      : 최대 임펄스 (px/s²). 링 정점에서의 가속도.
//   bandwidth  : 링의 두께(px). |dist - radius| < bandwidth 일 때 영향권.
export type Shockwave = {
  x: number;
  y: number;
  startTime: number;
  speed: number;
  duration: number;
  power: number;
  bandwidth: number;
};

// 게임: 시간 t 시점의 파동 반경.
export function shockwaveRadius(wave: Shockwave, t: number): number {
  return (t - wave.startTime) * wave.speed;
}

// 게임: 파동이 아직 살아있는가.
export function isShockwaveAlive(wave: Shockwave, t: number): boolean {
  return t - wave.startTime < wave.duration;
}

// 게임: (px, py) 위치의 세포에 가해지는 임펄스(가속도).
//   영향권 밖이면 (0, 0) 반환.
//   링 중심에 가까울수록 / 파동이 젊을수록 강함.
//   결과는 px/s² 단위. 호출자가 dt 곱해 속도에 누적.
export function shockwaveImpulse(
  wave: Shockwave,
  px: number,
  py: number,
  t: number,
): { dvx: number; dvy: number } {
  const dx = px - wave.x;
  const dy = py - wave.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // 게임: 정확히 원점이면 방향이 정의되지 않음. 무시.
  if (dist < 0.001) return { dvx: 0, dvy: 0 };

  const radius = shockwaveRadius(wave, t);
  const distFromRing = Math.abs(dist - radius);
  if (distFromRing > wave.bandwidth) return { dvx: 0, dvy: 0 };

  // 게임: 링 중심에서 멀어질수록 영향 ↓ (선형). 1 = 정확히 링 위.
  const ringFactor = 1 - distFromRing / wave.bandwidth;
  // 게임: 파동이 늙을수록 영향 ↓ (선형).
  const age = t - wave.startTime;
  const timeFactor = Math.max(0, 1 - age / wave.duration);

  const strength = wave.power * ringFactor * timeFactor;
  const nx = dx / dist;
  const ny = dy / dist;
  return { dvx: nx * strength, dvy: ny * strength };
}
