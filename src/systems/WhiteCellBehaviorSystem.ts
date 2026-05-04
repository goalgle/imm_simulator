// 백혈구 행동 시스템 (M3.1 — 자체 추진 도입).
//
// 호중구가 가장 가까운 세균(prey)을 향해 부드럽게 추진.
// 충격파의 임펄스는 ShockwaveSystem 이 별도로 vx/vy 에 누적시키므로
// 자체 추진과 자연스럽게 가산됨 (충격파로 던지면 일시적으로 desired velocity 와 다른 방향으로
// 빠르게 날아가다가 turnRate 에 따라 점차 다시 prey 추적 방향으로 수렴).

import type { WhiteCell } from '../entities/WhiteCell';
import { computeDesiredDirection, type Positioned, type Senses } from '../domain/drives';

export class WhiteCellBehaviorSystem {
  private cells: WhiteCell[] = [];

  add(cell: WhiteCell): void {
    this.cells.push(cell);
  }

  getAll(): readonly WhiteCell[] {
    return this.cells;
  }

  // 게임: 매 프레임 호출.
  //   prey : 세균 위치들 (drives.seekPrey 평가용)
  //
  //   주의: WhiteCell.update() 는 호출하지 않음 — BloodScene 이 별도로 호출.
  //         이 시스템은 vx/vy 에 desired velocity 를 lerp 하기만 함.
  //         호출 순서: ShockwaveSystem.applyToCells → applySeparation →
  //                   WhiteCellBehaviorSystem.update (lerp) → cell.update (위치 적분).
  update(
    dt: number,
    prey: readonly Positioned[],
  ): void {
    for (const cell of this.cells) {
      // 게임: 가장 가까운 prey 만 찾으면 됨 (drives.seekPrey 가 그것을 사용).
      let nearestPrey: Positioned | null = null;
      let bestDist2 = Infinity;
      for (const p of prey) {
        const dx = p.x - cell.x;
        const dy = p.y - cell.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          nearestPrey = p;
        }
      }

      const senses: Senses = {
        predators: [],
        allies: this.cells,
        nearestNutrient: null,
        nearestPrey,
      };

      const dir = computeDesiredDirection(cell, cell.dna.drives, senses);

      const speed = cell.dna.behavior.speed;
      const turnRate = cell.dna.behavior.turnRate;
      const desiredVx = dir.dirX * speed;
      const desiredVy = dir.dirY * speed;
      // 게임: 부드러운 lerp. turnRate=0 이면 변화 없음 (무영향 기본값).
      const k = 1 - Math.exp(-turnRate * dt);
      cell.vx += (desiredVx - cell.vx) * k;
      cell.vy += (desiredVy - cell.vy) * k;
    }
  }
}
