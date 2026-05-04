// 같은 종족 내 분리력 — 시각적으로 너무 붙지 않게 하는 물리적 처리.
// DNA 형질이 아닌 물리. 모든 같은 종족 오브젝트에 일관 적용.
//
// 동작:
//   두 오브젝트 거리 < (r1 + r2 + padding) 이면
//   서로 멀어지는 방향으로 가속도 누적 (vx/vy 변경).
//
// 다른 종족 간(예: 백혈구 ↔ 세균) 은 M3 충돌 시스템에서 처리 (다른 의미의 접촉).
//
// 이 파일은 Phaser 의존 없음.

// 게임: 분리 적용 가능한 엔티티 인터페이스. WhiteCell, Bacteria 모두 만족.
export type SeparableEntity = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly dna: { shape: { base: number } };
};

// 게임: 분리력 적용. 쌍별 O(N²) — N=20 정도라 충분.
//   padding  : 두 base 합 외에 추가로 비워둘 거리 (px)
//   strength : 가속도 크기 (px/s²). 겹침 비율에 비례하여 적용.
//   dt       : 프레임 시간 (초). vx/vy 누적 시 곱.
export function applySeparation(
  entities: SeparableEntity[],
  padding: number,
  strength: number,
  dt: number,
): void {
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      const minDist = a.dna.shape.base + b.dna.shape.base + padding;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const minDist2 = minDist * minDist;
      if (d2 >= minDist2) continue;
      if (d2 < 0.0001) {
        // 게임: 정확히 겹친 경우. 임의 방향으로 살짝 밀어 분리 시작.
        const angle = Math.random() * Math.PI * 2;
        const force = strength * dt;
        a.vx -= Math.cos(angle) * force;
        a.vy -= Math.sin(angle) * force;
        b.vx += Math.cos(angle) * force;
        b.vy += Math.sin(angle) * force;
        continue;
      }
      const dist = Math.sqrt(d2);
      // 게임: 겹침 비율 (0 ~ 1). 많이 겹칠수록 강한 분리.
      const overlap = (minDist - dist) / minDist;
      const force = overlap * strength * dt;
      const nx = dx / dist;
      const ny = dy / dist;
      // 게임: a 는 -방향, b 는 +방향 (서로 멀어짐)
      a.vx -= nx * force;
      a.vy -= ny * force;
      b.vx += nx * force;
      b.vy += ny * force;
    }
  }
}
