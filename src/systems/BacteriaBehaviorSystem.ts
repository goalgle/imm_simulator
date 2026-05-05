// 세균 행동 시스템 (M2.2 — drives 기반 부드러운 우선순위 + 관성).
// 매 프레임:
//   1) 각 세균: 가장 가까운 영양분 + 백혈구(포식자) + 동족 정보로 drives 평가
//   2) computeDesiredDirection 으로 단위 방향 산출
//   3) 부드러운 가속 (turnRate 기반 lerp)
//   4) 흡수 가능 거리에 영양분 있으면 소비 + 분열 카운터 +1
//   5) 분열 완료된 세균(pendingSpawn)의 자식 생성

import type { Bacteria } from '../entities/Bacteria';
import type { NutrientSystem } from './NutrientSystem';
import type { TeamSystem } from './TeamSystem';
import { Bacteria as BacteriaCtor } from '../entities/Bacteria';
import type { CellRenderer } from '../render/CellRenderer';
import type { DNA, Drives } from '../domain/dna';
import type { Positioned, Senses } from '../domain/drives';
import { applyDriveLerp } from './behaviorHelpers';

// 게임: 분열 시 자식 위치 오프셋 (px). 부모와 약간 떨어져 시작.
const SPAWN_OFFSET = 12;

// 게임: 공격 모드일 때 멤버/커맨더가 사용하는 임시 drives.
//   - avoidPredator weight ↓ (회피 중단)
//   - seekPrey weight ↑ (호중구 추격)
//   - seekNutrient ↓ (영양분 무시)
//   - followCommander ↓ (지휘관 옆이 아닌 적에게 집중)
const AGGRESSIVE_DRIVES: Drives = {
  avoidPredator:   { weight: 0.2, triggerRadius: 180 },
  seekNutrient:    { weight: 0 },
  seekPrey:        { weight: 1.5 },
  seekCommander:   { weight: 0 },
  avoidWorker:     { weight: 0, triggerRadius: 0 },
  spaceAlly:       { weight: 0.3, comfortRadius: 50 },
  seekAlly:        { weight: 0 },
  followCommander: { weight: 0 },
};

export class BacteriaBehaviorSystem {
  private bacteria: Bacteria[] = [];

  constructor(private readonly renderer: CellRenderer) {}

  add(bacteria: Bacteria): void {
    this.bacteria.push(bacteria);
  }

  // 게임: 흡수된 시체 청소 — 그래픽 핸들 destroy + 풀에서 제거.
  removeAbsorbed(): void {
    const remain: Bacteria[] = [];
    for (const b of this.bacteria) {
      if (b.isAbsorbed) b.destroy();
      else remain.push(b);
    }
    this.bacteria = remain;
  }

  // 게임: 외부(BloodScene)가 초기 세균을 생성할 때 사용.
  spawn(dna: DNA, x: number, y: number, phase = 0, initialHp?: number): Bacteria {
    const b = new BacteriaCtor(dna, this.renderer, x, y, phase, initialHp);
    this.add(b);
    return b;
  }

  getAll(): readonly Bacteria[] {
    return this.bacteria;
  }

  getAlive(): readonly Bacteria[] {
    return this.bacteria.filter((b) => !b.isDead());
  }

  // 게임: 매 프레임 호출.
  //   predators : 살아있는 백혈구 위치 (시체는 BloodScene 에서 필터링)
  //   teams     : 팀 정보 (멤버는 자기 팀 지휘관 위치를 senses 에 받음)
  update(
    t: number,
    dt: number,
    bounds: { width: number; height: number },
    nutrients: NutrientSystem,
    predators: readonly Positioned[],
    teams: TeamSystem,
  ): void {
    const aliveAllies = this.getAlive();
    for (const b of this.bacteria) {
      // 게임: 시체는 자체 update 가 낙하만 처리. 행동/흡수 모두 정지.
      if (b.isDead()) {
        b.update(t, dt, bounds);
        continue;
      }
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

      // 게임: 팀 정보 — 멤버는 getTeamFor, 커맨더는 getTeamOfCommander 로 자기 팀 조회.
      //        커맨더는 followCommander.weight=0 이라 commander 인자 영향 없지만,
      //        모드는 자기 팀 모드 따름.
      const team = b.isCommander()
        ? teams.getTeamOfCommander(b)
        : teams.getTeamFor(b);

      const commanderInfo = (team && !b.isCommander())
        ? {
            x: team.commander.x,
            y: team.commander.y,
            controlRadius: team.commander.currentCommandRange,
          }
        : null;

      // 게임: 모드별 drives + nearestPrey 분기.
      //   aggressive 면 멤버는 AGGRESSIVE_DRIVES + senses.nearestPrey = attackTarget.
      //   커맨더는 공격 모드여도 자기 DNA.drives 유지 (지휘 역할 — 직접 돌진 안 함, 후방에서 회피/영양분).
      //   defensive 면 모두 자기 DNA.drives.
      const isAggressive = team !== null && team.mode === 'aggressive' && team.attackTarget !== null;
      const useAggressive = isAggressive && !b.isCommander();
      const driveSet: Drives = useAggressive ? AGGRESSIVE_DRIVES : b.dna.drives;
      const target = useAggressive && team !== null && team.attackTarget !== null
        ? team.attackTarget
        : null;

      const senses: Senses = {
        predators,
        allies: aliveAllies,
        nearestNutrient: nutrient,
        nearestPrey: target,
        nearestCommander: null,
        nearestWorker: null,
        commander: commanderInfo,
      };

      // 게임: 약화된 세균은 추진력도 약화 (hpRatio 비례).
      const speed = b.dna.behavior.speed * b.hpRatio();
      applyDriveLerp(b, driveSet, senses, speed, b.dna.behavior.turnRate, dt);

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
