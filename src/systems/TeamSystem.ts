// 팀 관리 시스템 (M5.1 영입/탈퇴/해체 + M5.3 모드 결정).
//
// 매 프레임:
//   1) 죽은 커맨더의 팀 해체 (멤버는 무소속 복귀)
//   2) 살아있는 일반 세균이 어느 팀에도 속하지 않은 경우, 가까운 커맨더 팀에 영입 시도
//   3) 멤버가 currentCommandRange × LEAVE_FACTOR 이상 멀어지면 탈퇴
//   4) 모드 결정: 시야 내 가장 가까운 호중구 + 팀 총 HP > 호중구 HP × 우세계수 → aggressive

import type { Bacteria } from '../entities/Bacteria';
import type { WhiteCell } from '../entities/WhiteCell';
import type { DNA } from '../domain/dna';
import { getSoundSystem } from '../sound/SoundSystem';

// 게임: 멤버가 지휘범위 × 이 비율 이상 벗어나면 자동 탈퇴.
//        영입 거리(commandRange) 보다 살짝 넓게 두어 경계에서 깜빡이는 영입/탈퇴 방지.
const LEAVE_FACTOR = 1.5;

// 게임: 공격 모드 진입 우세계수. 팀 총 HP > 호중구 HP × 이 값 이면 공격.
//        1.5 = 50% 우세 마진. 박빙/약간 우세는 방어, 명확히 우세할 때만 공격.
const ATTACK_HP_THRESHOLD = 1.5;

// 게임: 공격 표적 우선순위. 작은 숫자 = 우선.
//   1순위 BCELL — 정지/약체라 잡기 쉬움 + 항체 위협 차단
//   2순위 TCELL — 호중구 진화 매개라 차단 시 호중구 보강 끊김
//   3순위 그 외 (NEUTROPHIL/SUPER/NK) — 직접 전투 대상
function priorityOf(dna: DNA): number {
  if (dna.kind === 'BCELL') return 1;
  if (dna.kind === 'TCELL') return 2;
  return 3;
}

export type TeamMode = 'defensive' | 'aggressive';

export type Team = {
  commander: Bacteria;
  members: Bacteria[];
  mode: TeamMode;
  // 게임: 공격 명령의 대상 호중구. defensive 면 null.
  //        WhiteCell 객체 자체를 들고 있어서 그가 죽거나 사라지면 자동 해제됨.
  attackTarget: WhiteCell | null;
};

export class TeamSystem {
  private teams: Team[] = [];
  // 게임: 빠른 lookup. bacteria → team 매핑.
  private memberToTeam = new Map<Bacteria, Team>();
  // 게임: 커맨더 사망 시각 기록. 일정 시간 후 일반 세균 1마리 진화 트리거용 (BloodScene 처리).
  private commanderDeathTimes: number[] = [];

  // 게임: 매 프레임 호출.
  //   bacteria   : 모든 세균 (커맨더 + 일반). 죽은 것 포함 가능 — 내부에서 isDead 체크.
  //   whiteCells : 모든 백혈구 (살아있는 것만 의미 있음 — 시체는 자동 제외).
  //   t          : 현재 시각 (초). 커맨더 사망 시각 기록용.
  update(bacteria: readonly Bacteria[], whiteCells: readonly WhiteCell[], t: number): void {
    this.removeDeadCommandersAndMembers(t);
    this.ensureTeamsForCommanders(bacteria);
    this.dropMembersOutOfRange();
    this.recruitNewMembers(bacteria);
    this.decideTeamModes(whiteCells);
  }

  // 게임: 커맨더가 죽거나 멤버가 죽으면 정리. 커맨더 사망 시각 기록.
  private removeDeadCommandersAndMembers(t: number): void {
    // 죽은 커맨더 팀 해체 — 멤버 매핑도 같이 제거. 사망 시각 기록.
    const aliveTeams: Team[] = [];
    for (const team of this.teams) {
      if (team.commander.isDead()) {
        for (const m of team.members) this.memberToTeam.delete(m);
        this.commanderDeathTimes.push(t);
        continue;
      }
      // 죽은 멤버는 팀에서 제거.
      const liveMembers: Bacteria[] = [];
      for (const m of team.members) {
        if (m.isDead()) {
          this.memberToTeam.delete(m);
          continue;
        }
        liveMembers.push(m);
      }
      team.members = liveMembers;
      aliveTeams.push(team);
    }
    this.teams = aliveTeams;
  }

  // 게임: 살아있는 커맨더가 팀이 없으면 빈 팀 생성.
  private ensureTeamsForCommanders(bacteria: readonly Bacteria[]): void {
    for (const b of bacteria) {
      if (b.isDead()) continue;
      if (!b.isCommander()) continue;
      if (this.teams.some((t) => t.commander === b)) continue;
      this.teams.push({
        commander: b,
        members: [],
        mode: 'defensive',
        attackTarget: null,
      });
    }
  }

  // 게임: 멤버가 너무 멀리 갔으면 탈퇴.
  private dropMembersOutOfRange(): void {
    for (const team of this.teams) {
      const cx = team.commander.x;
      const cy = team.commander.y;
      const limit = team.commander.currentCommandRange * LEAVE_FACTOR;
      const limit2 = limit * limit;
      const stay: Bacteria[] = [];
      for (const m of team.members) {
        const dx = m.x - cx;
        const dy = m.y - cy;
        if (dx * dx + dy * dy > limit2) {
          this.memberToTeam.delete(m);
          continue;
        }
        stay.push(m);
      }
      team.members = stay;
    }
  }

  // 게임: 빈자리 있는 팀이 currentCommandRange 안의 무소속 일반 세균을 영입.
  //        한 세균은 한 팀에만 속함. 이미 다른 팀 소속이면 갈아타기 X (단순화).
  private recruitNewMembers(bacteria: readonly Bacteria[]): void {
    for (const team of this.teams) {
      const max = team.commander.currentMaxTeamSize();
      if (team.members.length >= max) continue;

      const cx = team.commander.x;
      const cy = team.commander.y;
      const range = team.commander.currentCommandRange;
      const range2 = range * range;

      for (const b of bacteria) {
        if (team.members.length >= max) break;
        if (b.isDead()) continue;
        if (b.isCommander()) continue;
        if (this.memberToTeam.has(b)) continue;
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (dx * dx + dy * dy > range2) continue;
        team.members.push(b);
        this.memberToTeam.set(b, team);
      }
    }
  }

  // 게임: 각 팀의 mode/attackTarget 갱신.
  //   - 시야(visionRange) 안 가장 가까운 살아있는 호중구 후보 선정
  //   - 팀 총 HP (커맨더 + 멤버, 살아있는 것만) > 호중구 HP × 1.2 → aggressive
  //   - 그 외 → defensive (attackTarget=null)
  private decideTeamModes(whiteCells: readonly WhiteCell[]): void {
    for (const team of this.teams) {
      const cmd = team.commander;

      // 게임: "팀으로 이루어진" 조건 — 멤버가 baseTeamSize 이상 모여야 공격 모드 가능.
      //        그 미만이면 자동 방어 (커맨더 단독 / 소규모 팀은 회피).
      const minMembers = cmd.dna.command.baseTeamSize;
      if (team.members.length < minMembers) {
        team.mode = 'defensive';
        team.attackTarget = null;
        continue;
      }

      const cx = cmd.x;
      const cy = cmd.y;
      const visionR = cmd.currentVisionRange;
      const visionR2 = visionR * visionR;

      // 게임: 시야 내 살아있는 백혈구 중 우선순위 가장 높은 것 선택.
      //   - priorityOf 가 작을수록 우선 (1=BCELL, 2=TCELL, 3=기타)
      //   - 같은 우선순위 내에서는 가장 가까운 것
      let nearest: WhiteCell | null = null;
      let bestPriority = Infinity;
      let bestDist2 = Infinity;
      for (const w of whiteCells) {
        if (w.isDead()) continue;
        const dx = w.x - cx;
        const dy = w.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > visionR2) continue;
        const p = priorityOf(w.dna);
        if (p < bestPriority || (p === bestPriority && d2 < bestDist2)) {
          bestPriority = p;
          bestDist2 = d2;
          nearest = w;
        }
      }

      if (nearest === null) {
        team.mode = 'defensive';
        team.attackTarget = null;
        continue;
      }

      // 게임: 팀 총 HP — currentHp 는 직접 못 가져옴(private). hpRatio × maxHp 사용.
      let teamHp = cmd.hpRatio() * cmd.dna.combat.maxHp;
      for (const m of team.members) {
        if (m.isDead()) continue;
        teamHp += m.hpRatio() * m.dna.combat.maxHp;
      }
      const enemyHp = nearest.hpRatio() * nearest.dna.combat.maxHp;

      if (teamHp > enemyHp * ATTACK_HP_THRESHOLD) {
        // 게임: defensive → aggressive 전환 시 한 번만 사운드 — 매 프레임 반복 방지.
        const wasDefensive = team.mode !== 'aggressive';
        team.mode = 'aggressive';
        team.attackTarget = nearest;
        if (wasDefensive) getSoundSystem().playCommanderAttack();
      } else {
        team.mode = 'defensive';
        team.attackTarget = null;
      }
    }
  }

  // 게임: 외부 조회용.
  getTeams(): readonly Team[] {
    return this.teams;
  }

  getTeamFor(bacteria: Bacteria): Team | null {
    return this.memberToTeam.get(bacteria) ?? null;
  }

  // 게임: 커맨더 자신이 속한 팀 (자기 팀).
  getTeamOfCommander(commander: Bacteria): Team | null {
    return this.teams.find((t) => t.commander === commander) ?? null;
  }

  // 게임: durationSec 이상 경과한 커맨더 사망 record 를 반환하고 내부에서 제거.
  //        BloodScene 이 매 프레임 호출 → 일반 세균 1마리 진화 트리거.
  //        반환된 만큼 진화 처리해야 함 (호출자 책임).
  //        진화 실패 시 (후보 없음 등) requeueDeathRecord 로 다시 등록 가능.
  consumeExpiredDeathRecords(t: number, durationSec: number): number[] {
    const expired: number[] = [];
    const remain: number[] = [];
    for (const dt of this.commanderDeathTimes) {
      if (t - dt >= durationSec) expired.push(dt);
      else remain.push(dt);
    }
    this.commanderDeathTimes = remain;
    return expired;
  }

  // 게임: consumeExpiredDeathRecords 로 받은 record 가 진화에 못 쓰였을 때 재등록.
  //   대표 케이스: 커맨더 사망 후 모든 세균이 전멸 → 후보 0 → 진화 무산.
  //   사용자가 [B] 키로 세균 스폰 시 다음 진화 검사에서 다시 expired 처리되어 자동 진화됨.
  requeueDeathRecord(deathTime: number): void {
    this.commanderDeathTimes.push(deathTime);
  }
}
