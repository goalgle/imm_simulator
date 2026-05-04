// 세균 행동 시스템 (M2.2 — drives 기반 부드러운 우선순위 + 관성).
// 매 프레임:
//   1) 각 세균: 가장 가까운 영양분 + 백혈구(포식자) + 동족 정보로 drives 평가
//   2) computeDesiredDirection 으로 단위 방향 산출
//   3) 부드러운 가속 (turnRate 기반 lerp)
//   4) 흡수 가능 거리에 영양분 있으면 소비 + 분열 카운터 +1
//   5) 분열 완료된 세균(pendingSpawn)의 자식 생성

import type { Bacteria } from '../entities/Bacteria';
import type { NutrientSystem } from './NutrientSystem';
import { Bacteria as BacteriaCtor } from '../entities/Bacteria';
import type { CellRenderer } from '../render/CellRenderer';
import type { DNA } from '../domain/dna';
import { computeDesiredDirection, type Positioned } from '../domain/drives';

// 게임: 분열 시 자식 위치 오프셋 (px). 부모와 약간 떨어져 시작.
const SPAWN_OFFSET = 12;

export class BacteriaBehaviorSystem {
  private bacteria: Bacteria[] = [];

  constructor(private readonly renderer: CellRenderer) {}

  add(bacteria: Bacteria): void {
    this.bacteria.push(bacteria);
  }

  // 게임: 외부(BloodScene)가 초기 세균을 생성할 때 사용.
  spawn(dna: DNA, x: number, y: number, phase = 0): Bacteria {
    const b = new BacteriaCtor(dna, this.renderer, x, y, phase);
    this.add(b);
    return b;
  }

  getAll(): readonly Bacteria[] {
    return this.bacteria;
  }

  // 게임: 매 프레임 호출.
  //   predators : 백혈구 등 포식자 위치 (drives.avoidPredator 평가용)
  update(
    t: number,
    dt: number,
    bounds: { width: number; height: number },
    nutrients: NutrientSystem,
    predators: readonly Positioned[],
  ): void {
    for (const b of this.bacteria) {
      // 게임: 분열 진행 중에는 의사결정 정지 — 시각 효과에 집중.
      if (b.mitosis !== null) {
        b.vx = 0;
        b.vy = 0;
        b.update(t, dt, bounds);
        continue;
      }

      // 게임: 가장 가까운 영양분 (없으면 null)
      const idx = nutrients.findNearestIndex(b.x, b.y);
      const nutrient = idx >= 0 ? nutrients.get(idx) ?? null : null;

      // 게임: drives 평가 → 목표 단위 방향
      const dir = computeDesiredDirection(
        b,
        b.dna.drives,
        predators,
        this.bacteria,
        nutrient,
      );

      // 게임: 부드러운 가속. turnRate 가 클수록 desired velocity 로 빠르게 수렴.
      //        k = 1 - exp(-turnRate × dt). dt 가 작아도 안정적 lerp.
      const speed = b.dna.behavior.speed;
      const turnRate = b.dna.behavior.turnRate;
      const desiredVx = dir.dirX * speed;
      const desiredVy = dir.dirY * speed;
      const k = 1 - Math.exp(-turnRate * dt);
      b.vx += (desiredVx - b.vx) * k;
      b.vy += (desiredVy - b.vy) * k;

      // 게임: 흡수 판정 — 가장 가까운 영양분이 absorbRadius 안이면 소비.
      //        목표 방향이 영양분 쪽이 아니어도 (회피 우세 시) 가까이 있으면 흡수 가능.
      if (nutrient && idx >= 0) {
        const dx = nutrient.x - b.x;
        const dy = nutrient.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= b.absorbRadius()) {
          nutrients.consume(idx, t);
          b.registerAbsorb(t);
        }
      }

      b.update(t, dt, bounds);
    }

    // 게임: 분열 완료된 세균의 자식 생성 (별도 루프 — 반복 중 push 회피).
    const newborns: Bacteria[] = [];
    for (const b of this.bacteria) {
      if (b.pendingSpawn) {
        b.pendingSpawn = false;
        const angle = Math.random() * Math.PI * 2;
        const childX = b.x + Math.cos(angle) * SPAWN_OFFSET;
        const childY = b.y + Math.sin(angle) * SPAWN_OFFSET;
        newborns.push(
          new BacteriaCtor(b.dna, this.renderer, childX, childY, Math.random() * Math.PI * 2),
        );
      }
    }
    for (const child of newborns) this.add(child);
  }
}
