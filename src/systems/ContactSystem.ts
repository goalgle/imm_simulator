// 호중구 ↔ 세균 접촉 시스템 (M3.4 + M5.3 보상 + Stage 11 변이 분기).
// 매 프레임:
//   1) (백혈구, 세균) 쌍 검사 — 접촉 시 양쪽 hp -= 상대.attack × dt + 시각 자극
//      변이 분기: chaos 백혈구는 세균에 데미지 ×3 (정상 호중구 ×1)
//   2) (백혈구, 백혈구) 쌍 검사 — Stage 11 신규
//      한 쪽이라도 zombie/chaos 면 공격: zombie ×2, chaos ×3 데미지
//   3) 호중구가 방금 사망 → 데미지 가한 세균의 팀 전체에 영양분 흡수 효과 (registerAbsorb)
//
// 같은 종족 충돌은 SeparationSystem 이 별도 처리 (의미가 다름 — 물리적 비겹침).

import type { WhiteCell } from '../entities/WhiteCell';
import type { Bacteria } from '../entities/Bacteria';
import type { TeamSystem } from './TeamSystem';
import { isContacting } from '../domain/contact';

const COMBAT_STIMULUS_RATE = 2.0;

// 게임: 변이 호중구의 공격력 배율. mutation 필드 (Stage 11) 로 분기.
//   zombie ×2 (호중구 vs 만 적용 — 세균 vs 는 정상 ×1)
//   chaos  ×3 (호중구 vs + 세균 vs 모두 적용)
const ZOMBIE_ATTACK_MULT = 2;
const CHAOS_ATTACK_MULT = 3;

// 게임: T세포 영역 안 호중구가 세균 처치 시 회복할 HP 비율 (maxHp 대비).
//        0.3 = 30% — 연속 처치 가능하도록 살려둠. 조정 가능.
const TCELL_KILL_HEAL_RATIO = 0.3;

export class ContactSystem {
  // 게임: 매 프레임 호출. O(N×M) — 호중구 10 × 세균 10~50 = 500 쌍 검사. 가벼움.
  //   teamSystem : 호중구 사망 시 데미지 가한 세균의 팀에 보상 적용.
  update(
    whiteCells: readonly WhiteCell[],
    bacteria: readonly Bacteria[],
    dt: number,
    t: number,
    teamSystem: TeamSystem,
  ): void {
    // 게임: (1) 호중구↔세균 페어. chaos 호중구는 세균 데미지 ×3.
    for (const w of whiteCells) {
      if (w.isDead()) continue;
      for (const b of bacteria) {
        if (b.isDead()) continue;
        if (!isContacting(w, b)) continue;

        // 게임: 양쪽 데미지. attack 은 단위 시간당 데미지 (DPS).
        //   chaos 호중구는 세균에게 ×3. zombie 는 세균엔 ×1 (사용자 안: "세균과 접촉시는 호중구와 같은 반응").
        const bAliveBefore = !b.isDead();
        const wAttackMult = w.mutation === 'chaos' ? CHAOS_ATTACK_MULT : 1;
        b.applyDamage(w.dna.combat.attack * wAttackMult * dt);
        const wAliveBefore = !w.isDead();
        w.applyDamage(b.dna.combat.attack * dt);

        // 게임: 시각 자극. 양쪽 모두 빨강쪽으로 lerp.
        const stimulus = COMBAT_STIMULUS_RATE * dt;
        w.applyCombatStimulus(stimulus);
        b.applyCombatStimulus(stimulus);

        const bDiedNow = bAliveBefore && b.isDead();
        const wDiedNow = wAliveBefore && w.isDead();

        // 게임: 호중구 방금 사망 → 세균 팀 보상 (영양분 1개 흡수 효과).
        if (wDiedNow) {
          rewardTeamForKill(b, teamSystem, t);
          break;
        }

        // 게임: 세균 방금 사망 + 죽인 게 NEUTROPHIL 인 호중구 →
        //        T세포 commandRange 안이면 호중구 level +1 (5 도달 시 진화는 BloodScene 처리).
        if (bDiedNow && w.dnaKind === 'NEUTROPHIL') {
          rewardNeutrophilLevelup(w, whiteCells);
        }

        // 게임: infected 세균 사망 — host 기록. BloodScene 가 다음 프레임에 페이즈 2 자동 진입.
        //   killer 호중구가 같이 죽었으면 (b.killedByCell.isDead()) BloodScene 분기에서 무시.
        if (bDiedNow && b.isInfected) {
          b.killedByCell = w;
        }
      }
    }

    // 게임: (2) 호중구↔호중구 페어 — Stage 11 신규. 한 쪽이라도 zombie/chaos 면 공격 발생.
    //   변이 호중구는 자기 attack × mult (zombie=2, chaos=3) 로 공격.
    //   정상 호중구는 자기 attack × 1 로 반격 — "싸우면 데미지 받음" (변이 호중구도 피해 누적).
    //   둘 다 정상이면 공격 없음 (분리력만 작용).
    for (let i = 0; i < whiteCells.length; i++) {
      const a = whiteCells[i];
      if (a.isDead()) continue;
      const aMult = attackMultFor(a.mutation);
      for (let j = i + 1; j < whiteCells.length; j++) {
        const b = whiteCells[j];
        if (b.isDead()) continue;
        const bMult = attackMultFor(b.mutation);
        if (aMult === 0 && bMult === 0) continue; // 둘 다 정상 — 공격 없음
        if (!isContacting(a, b)) continue;

        // 게임: hostile 은 mult 적용, 정상은 ×1 반격.
        const aDamage = a.dna.combat.attack * (aMult > 0 ? aMult : 1);
        const bDamage = b.dna.combat.attack * (bMult > 0 ? bMult : 1);
        b.applyDamage(aDamage * dt);
        a.applyDamage(bDamage * dt);

        const stimulus = COMBAT_STIMULUS_RATE * dt;
        a.applyCombatStimulus(stimulus);
        b.applyCombatStimulus(stimulus);
      }
    }
  }
}

// 게임: mutation 별 공격력 배율. 정상=0 (호중구↔호중구에서 hostile 아님), zombie=2, chaos=3.
//   호중구↔호중구 페어에서만 hostile 식별. 호중구↔세균은 chaos 만 ×3 (별도 분기).
function attackMultFor(mutation: WhiteCell['mutation']): number {
  if (mutation === 'zombie') return ZOMBIE_ATTACK_MULT;
  if (mutation === 'chaos') return CHAOS_ATTACK_MULT;
  return 0;
}

// 게임: NEUTROPHIL 호중구가 세균을 처치한 순간, 가까운 T세포 영역 안이면 그 호중구 레벨업.
//   - cells 중 살아있는 TCELL 검사
//   - 호중구 위치가 어떤 T세포의 commandRange 안 → level +1
//   - 여러 T세포 영역 동시 만족 시 가장 가까운 T세포 1마리 기준 (한 번만 +1)
function rewardNeutrophilLevelup(killer: WhiteCell, cells: readonly WhiteCell[]): void {
  let bestDist2 = Infinity;
  let bestRange2 = 0;
  let inRange = false;
  for (const c of cells) {
    if (c.dnaKind !== 'TCELL') continue;
    if (c.isDead()) continue;
    const dx = killer.x - c.x;
    const dy = killer.y - c.y;
    const d2 = dx * dx + dy * dy;
    const r = c.dna.command.commandRange;
    const r2 = r * r;
    if (d2 <= r2 && d2 < bestDist2) {
      bestDist2 = d2;
      bestRange2 = r2;
      inRange = true;
    }
  }
  // bestRange2 는 사용하지 않지만 의도 명시.
  void bestRange2;
  if (inRange) {
    killer.level += 1;
    // 게임: 처치 보상 — 연속 전투 가능하도록 HP 회복.
    killer.heal(killer.dna.combat.maxHp * TCELL_KILL_HEAL_RATIO);
  }
}

// 게임: 호중구 처치 보상. 영양분 1개 흡수와 동등 효과 — 팀 전체에 적용.
function rewardTeamForKill(killer: Bacteria, teamSystem: TeamSystem, t: number): void {
  if (killer.isCommander()) {
    // 게임: 커맨더가 직접 처치. 자기 + 자기 팀 멤버.
    const team = teamSystem.getTeamOfCommander(killer);
    killer.registerAbsorb(t);
    if (team) {
      for (const m of team.members) m.registerAbsorb(t);
    }
    return;
  }

  // 게임: 일반 세균이 처치. 자기 + 자기 팀 (커맨더 + 다른 멤버).
  const team = teamSystem.getTeamFor(killer);
  killer.registerAbsorb(t);
  if (team) {
    team.commander.registerAbsorb(t);
    for (const m of team.members) {
      if (m !== killer) m.registerAbsorb(t);
    }
  }
}
