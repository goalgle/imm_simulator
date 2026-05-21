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
import type { AntibodySystem } from './AntibodySystem';
import { Bacteria as BacteriaCtor } from '../entities/Bacteria';
import type { CellRenderer } from '../render/CellRenderer';
import type { DNA, Drives } from '../domain/dna';
import type { Positioned, Senses } from '../domain/drives';
import { applyDriveLerp } from './behaviorHelpers';
import type { EntityRegistry } from '../domain/entityControl';
import { dnaKindToEntityKind } from '../domain/entityControl';

// 게임: 분열 시 자식 위치 오프셋 (px). 부모와 약간 떨어져 시작.
const SPAWN_OFFSET = 12;

// 게임: 분열 자식이 바이러스 보유 (infected) 가 될 확률. 페이즈 2 트리거 빈도 결정.
//   사용자 안 — 0.1 (10%). 부모 isInfected 와 무관, 매 자식마다 독립 주사위.
const INFECTED_CHILD_CHANCE = 0.1;

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
  // 게임: 스테이지 spawn/killed 카운터 (Session 20). spawn() 호출마다 stageSpawned++,
  //   매 프레임 사망 감지 (isDead && !wasCountedAsKilled) 시 stageKilled++.
  //   BloodScene 가 stage restart 시 resetStageCounters() 로 초기화.
  private stageSpawned = 0;
  private stageKilled = 0;
  // 게임: legacy 전역 frozen — EntityRegistry 도입 후에도 호환 유지.
  //   실제 분기는 (this.frozen OR registry.bacteria.frozen OR registry.bacteriaCommander.frozen) 합산.
  //   다음 정리 단계 (intro-script 마이그레이션) 후 제거 가능.
  frozen = false;

  constructor(
    private readonly renderer: CellRenderer,
    private readonly registry: EntityRegistry,
  ) {}

  resetStageCounters(): void {
    this.stageSpawned = 0;
    this.stageKilled = 0;
  }

  getStageSpawned(): number { return this.stageSpawned; }
  getStageKilled(): number { return this.stageKilled; }

  // 게임: 매 프레임 사망 감지 — BloodScene 가 update() 끝에 호출. 분열로 새로 spawn 된 자식도
  //   isDead 되면 카운트. 시작/wave/분열 모두 spawn() 호출 시 stageSpawned++.
  pollKilled(): void {
    for (const b of this.bacteria) {
      if (b.wasCountedAsKilled) continue;
      if (!b.isDead()) continue;
      b.wasCountedAsKilled = true;
      this.stageKilled++;
    }
  }

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

  // 게임: 외부(BloodScene)가 초기/wave/분열 세균을 생성할 때 사용.
  //   매 호출 stageSpawned++ — 별 평가 분모에 사용. 분열도 카운트되어 무한 증식 막을 동기 부여.
  //   registry.<kind>.enabled === false 면 spawn 무시 + null 반환 (컷신·디버그가 새 등장 차단).
  spawn(dna: DNA, x: number, y: number, phase = 0, initialHp?: number): Bacteria | null {
    if (!this.registry.get(dnaKindToEntityKind(dna.kind)).enabled) return null;
    const b = new BacteriaCtor(dna, this.renderer, x, y, phase, initialHp);
    this.add(b);
    this.stageSpawned++;
    return b;
  }

  getAll(): readonly Bacteria[] {
    return this.bacteria;
  }

  getAlive(): readonly Bacteria[] {
    return this.bacteria.filter((b) => !b.isDead());
  }

  // 게임: 매 프레임 호출.
  //   predators  : 살아있는 백혈구 위치 (시체는 BloodScene 에서 필터링)
  //   teams      : 팀 정보 (멤버는 자기 팀 지휘관 위치를 senses 에 받음)
  //   antibodies : B세포 항체. 영양분처럼 추적되지만 흡수 시 HP 감소.
  update(
    t: number,
    dt: number,
    bounds: { width: number; height: number },
    nutrients: NutrientSystem,
    predators: readonly Positioned[],
    teams: TeamSystem,
    antibodies: AntibodySystem,
  ): void {
    const aliveAllies = this.getAlive();
    for (const b of this.bacteria) {
      // 게임: 시체는 자체 update 가 낙하만 처리. 행동/흡수 모두 정지.
      if (b.isDead()) {
        b.update(t, dt, bounds);
        continue;
      }
      // 게임: frozen 분기 — legacy this.frozen OR registry control. 둘 중 하나라도 true 면 정지.
      const ctrl = this.registry.get(dnaKindToEntityKind(b.dna.kind));
      if (this.frozen || ctrl.frozen) {
        b.vx = 0;
        b.vy = 0;
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

      // 게임: 가장 가까운 영양분 vs 항체 비교 — 가까운 쪽이 senses.nearestNutrient.
      //        항체는 세균 입장에서 영양분처럼 보임 (행동은 동일).
      //        흡수 시점에 분기 — 영양분이면 분열 카운터 ↑, 항체면 HP 감소.
      const nIdx = nutrients.findNearestIndex(b.x, b.y);
      const nutrient = nIdx >= 0 ? nutrients.get(nIdx) ?? null : null;

      const antibodyList = antibodies.getAll();
      let abIdx = -1;
      let abDist2 = Infinity;
      for (let i = 0; i < antibodyList.length; i++) {
        const ab = antibodyList[i];
        if (ab.isAbsorbed) continue;
        const dx = ab.x - b.x;
        const dy = ab.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < abDist2) { abDist2 = d2; abIdx = i; }
      }
      const antibody = abIdx >= 0 ? antibodyList[abIdx] : null;

      // 게임: 둘 중 가까운 것 선택 (edible).
      let edible: Positioned | null = null;
      let edibleIsAntibody = false;
      if (nutrient !== null && antibody !== null) {
        const dn2 = (nutrient.x - b.x) ** 2 + (nutrient.y - b.y) ** 2;
        if (abDist2 < dn2) { edible = antibody; edibleIsAntibody = true; }
        else { edible = nutrient; }
      } else if (nutrient !== null) {
        edible = nutrient;
      } else if (antibody !== null) {
        edible = antibody;
        edibleIsAntibody = true;
      }

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
      const aggrTarget = useAggressive && team !== null && team.attackTarget !== null
        ? team.attackTarget
        : null;

      const senses: Senses = {
        predators,
        allies: aliveAllies,
        nearestNutrient: edible,        // 영양분 또는 항체 (가까운 쪽). 행동상 동일.
        nearestPrey: aggrTarget,         // 공격 모드 시 호중구 (멤버만)
        nearestCommander: null,
        nearestWorker: null,
        commander: commanderInfo,
      };

      // 게임: 약화된 세균은 추진력도 약화 (hpRatio 비례). registry.speedMul 추가 곱셈 (컷신 슬로우 등).
      const speed = b.dna.behavior.speed * b.hpRatio() * ctrl.speedMul;
      applyDriveLerp(b, driveSet, senses, speed, b.dna.behavior.turnRate, dt);

      // 게임: 흡수 판정 — 가장 가까운 edible(영양분/항체)이 absorbRadius 안이면 소비.
      //        영양분이면 분열 카운터 ↑, 항체면 hp 감소 (등록 X).
      if (edible !== null) {
        const dx = edible.x - b.x;
        const dy = edible.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= b.absorbRadius()) {
          if (edibleIsAntibody && abIdx >= 0) {
            const ab = antibodyList[abIdx];
            ab.isAbsorbed = true;
            b.applyDamage(ab.damage);
          } else if (!edibleIsAntibody && nIdx >= 0) {
            nutrients.consume(nIdx, t);
            b.registerAbsorb(t);
          }
        }
      }

      b.update(t, dt, bounds);
    }

    // 게임: 분열 완료된 세균의 자식 생성 (별도 루프 — 반복 중 push 회피).
    //   infected 부모는 분열 안 함 (Bacteria.updateAlive 에서 mitosis 시작 차단).
    //   자식은 부모 dna 상속 (정상 색) + 독립 10% 확률로 infected — 매번 새 주사위.
    //   registry.<kind>.enabled === false 면 자식 안 만듦 (부모 pendingSpawn 만 reset).
    const newborns: Bacteria[] = [];
    for (const b of this.bacteria) {
      if (b.pendingSpawn) {
        b.pendingSpawn = false;
        if (!this.registry.get(dnaKindToEntityKind(b.dna.kind)).enabled) continue;
        const angle = Math.random() * Math.PI * 2;
        const childX = b.x + Math.cos(angle) * SPAWN_OFFSET;
        const childY = b.y + Math.sin(angle) * SPAWN_OFFSET;
        const child = new BacteriaCtor(b.dna, this.renderer, childX, childY, Math.random() * Math.PI * 2);
        if (Math.random() < INFECTED_CHILD_CHANCE) child.setInfected();
        newborns.push(child);
      }
    }
    // 게임: 분열 자식도 stageSpawned 카운트 — 사용자가 처리해야 할 세균 수에 포함 (Session 20).
    //   killed/total 표시 = killed/spawned. 분열 안 잡으면 분모만 늘어남 → 시간 클리어 어려워짐.
    for (const child of newborns) {
      this.add(child);
      this.stageSpawned++;
    }

    // 게임: visible 일괄 토글 — registry.<kind>.visible 따라 handle.setVisible.
    //   행동/충돌은 별개. 컷신 hide 상태에서도 frozen=true 와 함께 쓰면 완전 정지된 채 안 보임.
    for (const b of this.bacteria) {
      const ctrl = this.registry.get(dnaKindToEntityKind(b.dna.kind));
      b.setVisible(ctrl.visible);
    }
  }
}
