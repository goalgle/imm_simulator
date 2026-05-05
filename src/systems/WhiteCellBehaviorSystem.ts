// 백혈구 행동 시스템 (M3.1 자체 추진, M3.4 시체 제외).
// 살아있는 호중구만 prey/ally 평가에 사용.

import type { WhiteCell } from '../entities/WhiteCell';
import type { Positioned, Senses } from '../domain/drives';
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

  update(dt: number, prey: readonly Positioned[]): void {
    const aliveAllies = this.getAlive();
    for (const cell of this.cells) {
      if (cell.isDead()) continue;

      // 게임: 가장 가까운 prey (살아있는 적만 인자에 들어왔다고 가정).
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
        allies: aliveAllies,
        nearestNutrient: null,
        nearestPrey,
        commander: null,
      };

      // 게임: 약화된 세포는 추진력도 약화 (hpRatio 비례).
      const speed = cell.dna.behavior.speed * cell.hpRatio();
      applyDriveLerp(cell, cell.dna.drives, senses, speed, cell.dna.behavior.turnRate, dt);
    }
  }
}
