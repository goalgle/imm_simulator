// 백혈구 행동 시스템 (M3.1 자체 추진, M3.4 시체 제외, M7 NK 분기).
//
// senses 채우기:
//   - nearestPrey: 가장 가까운 살아있는 세균 (어느 종이든) — 호중구류가 사용
//   - nearestCommander: 가장 가까운 살아있는 커맨더 — NK 가 사용
//   - nearestWorker: 가장 가까운 살아있는 일반 세균 (avoidWorker 거리 안만 계산해도 되지만
//                    단순화 — 항상 채움. evalAvoidWorker 가 거리 체크)
//
// speed 계산: max(hpRatio, minSpeedRatio) — NK 는 1.0 이라 HP 무관.

import type { WhiteCell } from '../entities/WhiteCell';
import type { Bacteria } from '../entities/Bacteria';
import type { Senses } from '../domain/drives';
import { applyDriveLerp } from './behaviorHelpers';

export class WhiteCellBehaviorSystem {
  private cells: WhiteCell[] = [];

  add(cell: WhiteCell): void {
    this.cells.push(cell);
  }

  removeAbsorbed(): void {
    const remain: WhiteCell[] = [];
    for (const c of this.cells) {
      if (c.isAbsorbed) c.destroy();
      else remain.push(c);
    }
    this.cells = remain;
  }

  getAll(): readonly WhiteCell[] {
    return this.cells;
  }

  getAlive(): readonly WhiteCell[] {
    return this.cells.filter((c) => !c.isDead());
  }

  // 게임: 매 프레임 호출.
  //   bacteria: 모든 세균 (살아있는 것 + 시체). 시체는 isDead 체크로 제외.
  //             내부에서 한 번 순회하며 nearestPrey/Commander/Worker 모두 산출.
  update(dt: number, bacteria: readonly Bacteria[]): void {
    const aliveAllies = this.getAlive();
    for (const cell of this.cells) {
      if (cell.isDead()) continue;

      // 게임: 한 번 순회로 세 종류 nearest 동시 계산.
      let nearestPrey: Bacteria | null = null;
      let nearestPreyDist2 = Infinity;
      let nearestCommander: Bacteria | null = null;
      let nearestCommanderDist2 = Infinity;
      let nearestWorker: Bacteria | null = null;
      let nearestWorkerDist2 = Infinity;

      for (const b of bacteria) {
        if (b.isDead()) continue;
        const dx = b.x - cell.x;
        const dy = b.y - cell.y;
        const d2 = dx * dx + dy * dy;

        if (d2 < nearestPreyDist2) {
          nearestPreyDist2 = d2;
          nearestPrey = b;
        }
        if (b.isCommander()) {
          if (d2 < nearestCommanderDist2) {
            nearestCommanderDist2 = d2;
            nearestCommander = b;
          }
        } else {
          if (d2 < nearestWorkerDist2) {
            nearestWorkerDist2 = d2;
            nearestWorker = b;
          }
        }
      }

      const senses: Senses = {
        predators: [],
        allies: aliveAllies,
        nearestNutrient: null,
        nearestPrey,
        nearestCommander,
        nearestWorker,
        commander: null,
      };

      // 게임: 약화된 세포는 추진력도 약화 (hpRatio 비례). 단, minSpeedRatio 가 캡.
      //        NK 는 minSpeedRatio=1 이라 hp 가 줄어도 항상 최대 속도.
      const ratio = Math.max(cell.hpRatio(), cell.dna.behavior.minSpeedRatio);
      const speed = cell.dna.behavior.speed * ratio;
      applyDriveLerp(cell, cell.dna.drives, senses, speed, cell.dna.behavior.turnRate, dt);
    }
  }
}
