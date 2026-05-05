// 호중구 ↔ 세균 접촉 시스템 (M3.4 + M5.3 보상).
// 매 프레임 모든 (백혈구, 세균) 쌍 검사 → 접촉 중이면:
//   1) 양쪽 hp -= 상대.attack × dt   (전투력 차이로 한쪽이 먼저 사망)
//   2) 양쪽 combatResponse 자극   (시각 — 빨강쪽 색조)
//   3) 호중구가 방금 사망 → 데미지 가한 세균의 팀 전체에 영양분 흡수 효과 (registerAbsorb)
//
// 같은 종족 충돌은 SeparationSystem 이 별도 처리 (의미가 다름 — 물리적 비겹침).

import type { WhiteCell } from '../entities/WhiteCell';
import type { Bacteria } from '../entities/Bacteria';
import type { TeamSystem } from './TeamSystem';
import { isContacting } from '../domain/contact';

const COMBAT_STIMULUS_RATE = 2.0;

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
    for (const w of whiteCells) {
      if (w.isDead()) continue;
      for (const b of bacteria) {
        if (b.isDead()) continue;
        if (!isContacting(w, b)) continue;

        // 게임: 양쪽 데미지. attack 은 단위 시간당 데미지 (DPS).
        b.applyDamage(w.dna.combat.attack * dt);
        const wAliveBefore = !w.isDead();
        w.applyDamage(b.dna.combat.attack * dt);

        // 게임: 시각 자극. 양쪽 모두 빨강쪽으로 lerp.
        const stimulus = COMBAT_STIMULUS_RATE * dt;
        w.applyCombatStimulus(stimulus);
        b.applyCombatStimulus(stimulus);

        // 게임: 호중구 방금 사망 → 데미지 가한 세균(b)의 팀 전체에 보상.
        //        무소속 세균이면 자기 자신만 흡수 효과.
        if (wAliveBefore && w.isDead()) {
          rewardTeamForKill(b, teamSystem, t);
          // 죽은 호중구는 더 이상 처리할 거 없으니 inner break.
          break;
        }
      }
    }
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
