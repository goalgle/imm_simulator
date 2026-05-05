// 백혈구 행동 시스템.
// M3.1 자체 추진, M3.4 시체 제외, M7 NK 분기, M7 호중구 흡수.
//
// senses 채우기:
//   - nearestPrey: 가장 가까운 살아있는 세균 (호중구류 사용)
//   - nearestCommander: 가장 가까운 살아있는 커맨더 (NK 사용)
//   - nearestWorker: 가장 가까운 살아있는 일반 세균 (NK 회피용)
//
// NEUTROPHIL 만 추가 분기 — nearestPrey 동적 결정:
//   자기 약함 (hpRatio < 1/4)        → 강한 동료 (흡수 받기 위해)
//   자기 충분 + 약한 동료 있음        → 약한 동료 (흡수 시도)
//   그 외                             → 가장 가까운 세균
//
// 흡수 처리: 매 프레임 NEUTROPHIL 페어 거리 검사. 한 쪽 약하면 흡수.
// 슈퍼 호중구 변환: mergeCounter ≥ 2 → 자기 isAbsorbed=true + 같은 자리에 NEUTROPHIL_SUPER 생성.

import type { WhiteCell } from '../entities/WhiteCell';
import { WhiteCell as WhiteCellCtor } from '../entities/WhiteCell';
import type { Bacteria } from '../entities/Bacteria';
import type { Senses, Positioned } from '../domain/drives';
import { applyDriveLerp } from './behaviorHelpers';
import { NEUTROPHIL, NEUTROPHIL_SUPER } from '../domain/dna';
import type { CellRenderer } from '../render/CellRenderer';

// 게임: 흡수 발동 거리 = baseRadius 합 + 이 padding.
//        분리력보다 살짝 짧게 두어 흡수가 우선되도록.
const FUSION_PADDING = 2;

// 게임: 슈퍼 호중구로 변환되는 누적 흡수 횟수.
const FUSION_THRESHOLD = 2;

export class WhiteCellBehaviorSystem {
  private cells: WhiteCell[] = [];

  constructor(private readonly renderer: CellRenderer) {}

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

  update(dt: number, bacteria: readonly Bacteria[]): void {
    const aliveAllies = this.getAlive();
    for (const cell of this.cells) {
      if (cell.isDead()) continue;

      // 게임: 모든 살아있는 세균 한 번 순회로 nearest 들 동시 산출.
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
        if (d2 < nearestPreyDist2) { nearestPreyDist2 = d2; nearestPrey = b; }
        if (b.isCommander()) {
          if (d2 < nearestCommanderDist2) { nearestCommanderDist2 = d2; nearestCommander = b; }
        } else {
          if (d2 < nearestWorkerDist2) { nearestWorkerDist2 = d2; nearestWorker = b; }
        }
      }

      // 게임: NEUTROPHIL 만 prey 동적 분기 — 동료 흡수 행동.
      //        DNA 동등성 비교: 같은 NEUTROPHIL 객체 참조면 일반 호중구.
      let prey: Positioned | null = nearestPrey;
      if (cell.dna === NEUTROPHIL) {
        const allyTarget = this.findAllyTarget(cell, aliveAllies);
        if (allyTarget !== null) {
          prey = allyTarget; // 동료 우선 (자기 약하면 강한 동료, 자기 강하면 약한 동료)
        }
      }

      const senses: Senses = {
        predators: [],
        allies: aliveAllies,
        nearestNutrient: null,
        nearestPrey: prey,
        nearestCommander,
        nearestWorker,
        commander: null,
      };

      const ratio = Math.max(cell.hpRatio(), cell.dna.behavior.minSpeedRatio);
      const speed = cell.dna.behavior.speed * ratio;
      applyDriveLerp(cell, cell.dna.drives, senses, speed, cell.dna.behavior.turnRate, dt);
    }

    // 게임: 호중구 흡수 처리. update 끝에 한 번 — 갱신된 위치 기준.
    this.processFusion();
  }

  // 게임: NEUTROPHIL 의 동료 흡수 추적 대상 결정.
  //   self.isWeak() 면 강한 동료, 아니면 약한 동료. 적절한 후보 없으면 null.
  private findAllyTarget(self: WhiteCell, aliveAllies: readonly WhiteCell[]): WhiteCell | null {
    let best: WhiteCell | null = null;
    let bestDist2 = Infinity;
    const wantWeak = !self.isWeak(); // 자기 강함 → 약한 동료, 자기 약함 → 강한 동료
    for (const ally of aliveAllies) {
      if (ally === self) continue;
      if (ally.dna !== NEUTROPHIL) continue; // 일반 호중구끼리만
      const allyWeak = ally.isWeak();
      if (wantWeak && !allyWeak) continue;
      if (!wantWeak && allyWeak) continue;
      const dx = ally.x - self.x;
      const dy = ally.y - self.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) { bestDist2 = d2; best = ally; }
    }
    return best;
  }

  // 게임: 호중구 페어 흡수 검사.
  //   조건: 둘 다 살아있는 NEUTROPHIL + 거리 < r1 + r2 + padding + 한 쪽이 isWeak()
  //   처리: 약한 호중구 isAbsorbed=true (시체 X, 즉시 소멸).
  //         강한 호중구 mergeCounter +1. 2 도달 시 슈퍼 호중구로 변환.
  private processFusion(): void {
    const candidates = this.cells.filter(
      (c) => !c.isDead() && !c.isAbsorbed && c.dna === NEUTROPHIL,
    );
    const transformed: { x: number; y: number }[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (a.isAbsorbed) continue;
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (a.isAbsorbed) break;
        if (b.isAbsorbed) continue;

        const aWeak = a.isWeak();
        const bWeak = b.isWeak();
        // 한 쪽만 약해야 함. 둘 다 약하거나 둘 다 강하면 흡수 X.
        if (aWeak === bWeak) continue;

        const minDist = a.dna.shape.base + b.dna.shape.base + FUSION_PADDING;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy >= minDist * minDist) continue;

        const weak = aWeak ? a : b;
        const strong = aWeak ? b : a;
        weak.isAbsorbed = true;
        strong.mergeCounter++;
        if (strong.mergeCounter >= FUSION_THRESHOLD) {
          // 슈퍼 호중구 변환: 자기 정리 + 같은 자리에 NEUTROPHIL_SUPER 생성.
          transformed.push({ x: strong.x, y: strong.y });
          strong.isAbsorbed = true;
        }
      }
    }

    // 게임: 변환된 슈퍼 호중구 spawn (전체 페어 검사 후 한 번에 — iteration 중 push 회피).
    for (const pos of transformed) {
      const phase = Math.random() * Math.PI * 2;
      this.cells.push(new WhiteCellCtor(NEUTROPHIL_SUPER, this.renderer, pos.x, pos.y, phase));
    }
  }
}
