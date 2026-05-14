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
import { WhiteCell as WhiteCellCtor, CANCER_DIVIDE_IMPULSE } from '../entities/WhiteCell';
import type { Bacteria } from '../entities/Bacteria';
import type { Senses, Positioned } from '../domain/drives';
import { applyDriveLerp } from './behaviorHelpers';
import { NEUTROPHIL_SUPER } from '../domain/dna';
import type { CellRenderer } from '../render/CellRenderer';
import type { AntibodySystem } from './AntibodySystem';

// 게임: 흡수 발동 거리 = baseRadius 합 + 이 padding.
//   2 → 20 (Session 16) — 분리력(SEPARATION_PADDING=4, strength=400 px/s²)에 밀려나기 전
//   여유를 두어 흡수가 자주 발동하도록 완화. 두 호중구가 살짝 부딪히는 정도면 흡수.
const FUSION_PADDING = 20;

// 게임: 슈퍼 호중구로 변환되는 누적 흡수 횟수.
const FUSION_THRESHOLD = 2;

// 게임: fusion 시 강한 호중구의 뒤로 밀리는 반동 (px/s).
//   약한 호중구가 빨려들어가는 방향의 반대로 임펄스 — WhiteCell.FRICTION (1.5/sec) 로 자연 감속.
//   값이 클수록 더 멀리 밀림. 50 = 0.5초 후 약 20px 밀림 (마찰 적용).
const FUSION_RECOIL_IMPULSE = 50;

export class WhiteCellBehaviorSystem {
  private cells: WhiteCell[] = [];

  constructor(
    private readonly renderer: CellRenderer,
    private readonly antibodySystem: AntibodySystem,
  ) {}

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
    // 게임: senses.allies 후보에서 변이 호중구 제외 — T세포의 seekAlly 등이 변이 호중구를
    //   동족으로 인식 X. spaceAlly (회피) 도 변이 호중구 무시 — 분리력은 별도 시스템에서 처리.
    //   findAllyTarget / findHostileWhiteCellTarget 은 별도 필터 갖고 있으니 aliveAllies 그대로 사용.
    const sensesAllies = aliveAllies.filter((a) => a.mutation === null);
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

      // 게임: NEUTROPHIL 만 prey 동적 분기.
      //   - zombie 변이: 가까운 다른 백혈구만 추적 (호중구만 공격)
      //   - chaos 변이: 호중구 + 세균 중 가까운 쪽 (무차별 공격)
      //   - 정상: 동료 흡수 행동 (자기 약하면 강한 동료, 자기 강하면 약한 동료)
      let prey: Positioned | null = nearestPrey;
      if (cell.dnaKind === 'NEUTROPHIL') {
        if (cell.mutation === 'zombie') {
          const hostileTarget = this.findHostileWhiteCellTarget(cell, aliveAllies);
          if (hostileTarget !== null) prey = hostileTarget;
        } else if (cell.mutation === 'chaos') {
          // 호중구 후보 + 세균 후보 (nearestPrey) 중 더 가까운 쪽
          const wcTarget = this.findHostileWhiteCellTarget(cell, aliveAllies);
          prey = closerOf(cell, wcTarget, nearestPrey);
        } else {
          const allyTarget = this.findAllyTarget(cell, aliveAllies);
          if (allyTarget !== null) prey = allyTarget;
        }
      }

      const senses: Senses = {
        predators: [],
        allies: sensesAllies,
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

    // 게임: B세포 항체 발사. cooldown 갱신 + 발사 가능 시 표적 결정 후 spawn.
    this.processBCellFiring(dt, bacteria);

    // 게임: cancer 분열 처리 — pendingCancerSpawn flag 가 set 된 부모마다 자식 1마리 spawn.
    this.processCancerDivision();
  }

  // 게임: cancer 분열 — pendingCancerSpawn flag 가 켜진 부모에서 자식 1마리 spawn.
  //   자식은 부모와 같은 위치 ±부모 base 만큼 좌 또는 우. vx 임펄스도 같은 방향.
  //   자손은 setMutation('cancer') 만 호출 (HP 풀 회복) — beginCancerDivide 안 함 → 분열 1번만.
  //   parent.dna 가 cancer 색 적용 상태라 자식 cloneDna 도 같은 색 (정상).
  private processCancerDivision(): void {
    const newborns: WhiteCell[] = [];
    for (const c of this.cells) {
      if (!c.pendingCancerSpawn) continue;
      c.pendingCancerSpawn = false;
      const side = Math.random() < 0.5 ? -1 : 1;
      const offsetX = side * c.dna.shape.base * 0.6;
      const phase = Math.random() * Math.PI * 2;
      const child = new WhiteCellCtor(c.dna, this.renderer, c.x + offsetX, c.y, phase);
      child.setMutation('cancer');
      child.vx = side * CANCER_DIVIDE_IMPULSE;
      newborns.push(child);
    }
    for (const n of newborns) this.cells.push(n);
  }

  // 게임: B세포 발사 처리. 시야 안 가장 가까운 세균 / 없으면 무작위 방향.
  //   armament.fireRange 안의 살아있는 세균 후보 1마리 선정 → 그 방향.
  //   armament.projectileSpeed/Damage/Range 가 항체 속성으로 전달됨.
  private processBCellFiring(dt: number, bacteria: readonly Bacteria[]): void {
    for (const cell of this.cells) {
      if (cell.isDead()) continue;
      if (cell.dnaKind !== 'BCELL') continue;

      cell.fireCooldownRemaining -= dt;
      if (cell.fireCooldownRemaining > 0) continue;

      const range = cell.dna.armament.fireRange;
      const range2 = range * range;
      let target: Bacteria | null = null;
      let bestDist2 = Infinity;
      for (const b of bacteria) {
        if (b.isDead()) continue;
        const dx = b.x - cell.x;
        const dy = b.y - cell.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range2) continue;
        if (d2 < bestDist2) { bestDist2 = d2; target = b; }
      }

      let dirX: number;
      let dirY: number;
      if (target !== null) {
        const dx = target.x - cell.x;
        const dy = target.y - cell.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.001) {
          // 게임: 거의 같은 위치 — 무작위 방향으로 fallback.
          const angle = Math.random() * Math.PI * 2;
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
        } else {
          dirX = dx / d;
          dirY = dy / d;
        }
      } else {
        // 게임: 시야 안 표적 없음 — 무작위 방향.
        const angle = Math.random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      }

      this.antibodySystem.spawn(cell.x, cell.y, dirX, dirY, cell.dna.armament);
      cell.fireCooldownRemaining = cell.dna.armament.fireCooldown;
    }
  }

  // 게임: NEUTROPHIL 의 동료 흡수 추적 대상 결정.
  //   self.isWeak() 면 강한 동료, 아니면 약한 동료. 적절한 후보 없으면 null.
  //   변이된 호중구 (zombie/chaos 등) 는 흡수 대상에서 제외 — 일반 호중구만 fusion.
  private findAllyTarget(self: WhiteCell, aliveAllies: readonly WhiteCell[]): WhiteCell | null {
    let best: WhiteCell | null = null;
    let bestDist2 = Infinity;
    const wantWeak = !self.isWeak(); // 자기 강함 → 약한 동료, 자기 약함 → 강한 동료
    for (const ally of aliveAllies) {
      if (ally === self) continue;
      if (ally.dnaKind !== 'NEUTROPHIL') continue; // 일반 호중구끼리만
      if (ally.mutation !== null) continue; // 변이된 호중구 흡수 X
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

  // 게임: zombie/chaos 변이 호중구의 추적 대상. 자기 제외 가장 가까운 살아있는 백혈구.
  //   호중구 / NK / SUPER / BCELL / TCELL 모두 후보 (좀비 = 동료 백혈구 무차별 공격 의도).
  //   ContactSystem 의 호중구↔호중구 페어 검사가 실제 데미지 처리.
  private findHostileWhiteCellTarget(self: WhiteCell, aliveAllies: readonly WhiteCell[]): WhiteCell | null {
    let best: WhiteCell | null = null;
    let bestDist2 = Infinity;
    for (const ally of aliveAllies) {
      if (ally === self) continue;
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
      // 게임: fusing 중 / 변이된 호중구 (zombie/chaos 등) 는 fusion 후보에서 제외.
      //   변이 호중구는 추적 대상이 동료 백혈구 (ContactSystem 분기) 라 의미상 fusion 대상 아님.
      (c) => !c.isDead() && !c.isAbsorbed && !c.isFusing()
        && c.dnaKind === 'NEUTROPHIL' && c.mutation === null,
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
        // 게임: 즉시 isAbsorbed 대신 애니메이션 시작 — weak 가 strong 으로 빨려들어감.
        //   완료(0.35s 후) 시 weak.isAbsorbed=true 로 자동 정리.
        weak.startFusion(strong);
        // 게임: 강한 호중구 반동 — 약한 호중구가 들어오는 방향의 반대로 임펄스.
        //   weak → strong 방향이 흡수 방향이므로, 그 반대(= strong → weak 의 반대 = strong 위치 - weak 위치 의 반대)
        //   strong 입장에서 weak 가 자기쪽으로 오니, weak 의 반대편으로 살짝 밀림.
        const rdx = strong.x - weak.x;
        const rdy = strong.y - weak.y;
        const rd = Math.hypot(rdx, rdy) || 1;
        strong.vx += (rdx / rd) * FUSION_RECOIL_IMPULSE;
        strong.vy += (rdy / rd) * FUSION_RECOIL_IMPULSE;
        strong.mergeCounter++;
        if (strong.mergeCounter >= FUSION_THRESHOLD) {
          // 슈퍼 호중구 변환: 자기 정리 + 같은 자리에 NEUTROPHIL_SUPER 생성.
          //   weak 의 fusion 애니메이션은 target.x/y 마지막 좌표를 계속 읽으므로 안전.
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

// 게임: from 기준 두 후보 중 더 가까운 것. 둘 다 null 이면 null.
//   chaos 호중구의 prey 결정 — 호중구 후보 vs 세균 후보 중 가까운 쪽 선택.
function closerOf(from: Positioned, a: Positioned | null, b: Positioned | null): Positioned | null {
  if (a === null) return b;
  if (b === null) return a;
  const adx = a.x - from.x;
  const ady = a.y - from.y;
  const bdx = b.x - from.x;
  const bdy = b.y - from.y;
  return adx * adx + ady * ady < bdx * bdx + bdy * bdy ? a : b;
}
