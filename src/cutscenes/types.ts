// 컷신 시스템 (Session 21). 게임 시작 시 대본 형태로 객체/시스템을 소개.
//
// 사용 (선언적 step — control/spawn/pause/waitFor):
//   import { narration, control, spawn, pause, waitFor, end } from './types';
//   export const MY_CUTSCENE = [
//     narration(`첫번째 라인.`),
//     control('bacteria', { enabled: false, frozen: true }),    // 세균 등장 차단 + 정지
//     spawn('nutrient', 5, { spread: 120, interval: 0.5 }),     // 영양분 5개 순차
//     pause(0.6),
//     control('bacteria', { enabled: true, frozen: false }),
//     spawn('bacteria', 2, { spread: 80 }),
//     waitFor('nutrientsConsumed', 15),                         // 영양분 다 먹힐 때까지 (max 15s)
//     narration(`다음 텍스트.`),
//     end(),
//   ];
//
// step 종류:
//   - narration : 단어별 타이핑 + 클릭으로 다음. 여러 줄 = 자동 진행 (라인 사이 짧은 pause).
//   - control   : EntityRegistry.set(kind, partial) 즉시 적용 후 다음 step.
//   - spawn     : 지정 종을 count 만큼 spawn. interval > 0 면 순차, 0/생략 면 일괄.
//   - pause     : seconds 초 시간 대기.
//   - waitFor   : 게임 상태 조건 충족 시까지 대기 (maxSeconds 안전망).
//   - action    : (legacy) 코드 핸들러 호출. 마이그레이션 완료 후 제거 예정.
//   - end       : 컷신 종료. placing 또는 running 으로 전환.
//
// Phaser 의존 0 — 도메인 계층. BloodScene 이 import 해서 시퀀스 해석.

import type { EntityKind, EntityControl } from '../domain/entityControl';

// 게임: spawn step 의 위치/분포 옵션. 생략 시 화면 중앙 정확 위치, 일괄 spawn.
//   cx, cy          : 중심 좌표. 생략 시 화면 중앙.
//   spread          : ±spread 사각 박스 안 무작위. 생략 시 0 = 정확한 위치.
//   interval        : 순차 spawn 간격 (초). 생략 시 0 = 모두 같은 프레임에.
//   sparkleSeconds  : spawn 완료 후 spawn 위치마다 노란 원 펄스 (반지름 ↑ + alpha ↓).
//                     그 시간만큼 step 머묾 → 효과 보장. 생략/0 = 효과 없음 + 즉시 advance.
//                     영양분 등장 "별 반짝임" 시연용. 다른 종에도 적용 가능.
//   infectedChance  : 0~1. spawn 한 개체가 바이러스 보유 (infected) 일 확률.
//                     0 (생략) = 모두 정상, 1 = 모두 infected, 0.3 = 약 30% 가 infected.
//                     bacteria / bacteriaCommander 에만 의미. 다른 종은 무영향.
export type SpawnArea = {
  cx?: number;
  cy?: number;
  spread?: number;
  interval?: number;
  sparkleSeconds?: number;
  infectedChance?: number;
};

// 게임: waitFor step 의 조건 — 게임 상태 기반.
//   nutrientsConsumed      : nutrientSystem.getActiveCount() === 0 (모든 영양분 흡수됨)
//   bacteriaEliminated     : 살아있는 세균 0
//   neutrophilsEliminated  : 살아있는 호중구류 (NEUTROPHIL/NK/SUPER) 0
//   whiteCellsEliminated   : 살아있는 모든 백혈구 0 (BCELL/TCELL 포함)
export type WaitCondition =
  | 'nutrientsConsumed'
  | 'bacteriaEliminated'
  | 'neutrophilsEliminated'
  | 'whiteCellsEliminated';

// 게임: nutrientRegen step 의 옵션.
//   cx, cy        : 부활 박스 중심. 생략 시 살아있는 백혈구 centroid (없으면 화면 중앙).
//   half          : ±half 사각 박스. 생략 시 80.
//   initialCount  : 즉시 활성화 슬롯 수. 생략 시 6.
//   slowWhenBacteriaAbove : 동적 부활 속도 조절. 살아있는 세균 수가 count 이상이면
//                            consume 시 respawnDelay 가 (1 / regenMul) 배.
//                            예: { count: 20, regenMul: 0.5 } = 세균 ≥ 20 시 리젠 속도 절반 (부활 간격 2배).
//                            세균 수가 임계 이하로 떨어지면 자동으로 정상 속도 복구.
//                            컷신 종료 시 또는 다른 nutrientRegen 호출 시 reset.
export type NutrientRegenOptions = {
  cx?: number;
  cy?: number;
  half?: number;
  initialCount?: number;
  slowWhenBacteriaAbove?: { count: number; regenMul: number };
};

export type CutsceneStep =
  | { type: 'narration'; lines: string[] }
  | { type: 'warning'; lines: string[] }
  | { type: 'action'; kind: string }
  | { type: 'control'; kind: EntityKind; set: Partial<EntityControl> }
  | { type: 'spawn'; kind: EntityKind; count: number; area?: SpawnArea }
  | { type: 'place'; kind: EntityKind; label: string }
  | { type: 'pause'; seconds: number }
  | { type: 'waitFor'; condition: WaitCondition; maxSeconds: number }
  | { type: 'waitForShockwaves'; count: number; maxSeconds: number }
  | { type: 'waitForBacteriaKilled'; count: number; maxSeconds: number }
  | { type: 'evolveCommander'; afterSeconds: number }
  | { type: 'nutrientRegen'; options: NutrientRegenOptions }
  | { type: 'clear' }
  | { type: 'end' };

// 게임: 대본 friendly helper — backtick multi-line string 들여쓰기 자동 trim + 빈 라인 제거.
//   사용 예:
//     narration(`
//       캄캄하죠?
//       당신의 혈관입니다.
//     `)
//   결과 lines = ['캄캄하죠?', '당신의 혈관입니다.']
export function narration(text: string): CutsceneStep {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { type: 'narration', lines };
}

// 게임: narration 의 강조 변형 — 붉은 굵은 글씨 + 좌우 미세 흔들림. 동작은 narration 과 동일
//   (단어별 타이핑 + 클릭으로 다음). 시각 효과만 다름. "경고/주의" 톤 멘트에 사용.
export function warning(text: string): CutsceneStep {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { type: 'warning', lines };
}

// 게임: 액션 step — (legacy) 코드 핸들러 호출. 새 시퀀스는 control/spawn/pause 권장.
//   현재 정의된 kind: 'spawnNutrients' | 'spawnBacteria' | 'spawnNeutrophils' | 'reinforcement'.
//   마이그레이션 완료 후 제거 예정.
export function action(kind: string): CutsceneStep {
  return { type: 'action', kind };
}

// 게임: EntityRegistry.set(kind, partial) 즉시 적용 후 다음 step. 등장/표시/정지/속도/확률 모두.
//   예: control('bacteria', { frozen: true })
//       control('neutrophil', { enabled: false, visible: false })
export function control(kind: EntityKind, set: Partial<EntityControl>): CutsceneStep {
  return { type: 'control', kind, set };
}

// 게임: 지정 종을 count 만큼 spawn. area 로 위치/분포/순차 간격 지정.
//   interval=0 (생략) → 모두 같은 프레임에. interval>0 → 매 interval 초마다 1개.
//   순차 spawn 중에도 ACTION step 이 진행으로 간주되지 않음 — count 모두 끝나야 다음 step.
export function spawn(kind: EntityKind, count: number, area?: SpawnArea): CutsceneStep {
  return { type: 'spawn', kind, count, area };
}

// 게임: seconds 초 대기 후 다음 step. 시뮬레이션은 그동안 계속 진행 (frozen 안 켜져 있으면).
export function pause(seconds: number): CutsceneStep {
  return { type: 'pause', seconds };
}

// 게임: 조건 충족 또는 maxSeconds 경과 시 다음 step. 둘 중 먼저 도달하는 쪽.
//   condition 은 미리 정의된 WaitCondition (게임 상태 기반).
//   maxSeconds 안전망 — 조건 영영 안 충족돼도 강제 진행 (대본 멈춤 방지).
export function waitFor(condition: WaitCondition, maxSeconds: number): CutsceneStep {
  return { type: 'waitFor', condition, maxSeconds };
}

// 게임: 사용자가 충격파 N번 발사하면 다음 step. maxSeconds 안전망.
//   step 진입 시 카운터 0 reset → 그 후 발사한 것만 카운트.
//   cutscene 중에도 화면 탭 → 충격파 발사 가능 (이 step 동안만 인터렉션 활성).
//   다른 step (narration 등) 에선 화면 탭이 평소대로 동작.
export function waitForShockwaves(count: number, maxSeconds: number): CutsceneStep {
  return { type: 'waitForShockwaves', count, maxSeconds };
}

// 게임: step 진입 후 세균 N마리 사망 시 다음 step. maxSeconds 안전망.
//   step 진입 시점의 stageKilled 를 baseline 으로 저장 → 그 후 추가 사망만 카운트.
//   분열/wave 와 무관 — 사망 이벤트만. "호중구가 N마리 잡으면 진행" 시연용.
export function waitForBacteriaKilled(count: number, maxSeconds: number): CutsceneStep {
  return { type: 'waitForBacteriaKilled', count, maxSeconds };
}

// 게임: 일반 세균 1마리 → 커맨더 자동 진화 트리거. afterSeconds 후 게임 내 진화 발생.
//   즉시 advance — 백그라운드에서 evolveCommanders 루프가 시간 만료 시 변환.
//   기존 reinforcement ACTION 의 "5초 후 자연 등장" 메커니즘 복원 (단계 6 마이그레이션 누락분).
//   인자:
//     afterSeconds : 0~ — 이만큼 후 진화 발생. 내부적으로 deathTime = gameTime - (10 - afterSeconds)
//                    로 backdate 하여 COMMANDER_EVOLUTION_DELAY(10) 와 차감.
export function evolveCommander(afterSeconds: number): CutsceneStep {
  return { type: 'evolveCommander', afterSeconds };
}

// 게임: 영양분 부활 박스 set + frozen 해제 + 초기 활성화. 즉시 advance.
//   기존 reinforcement ACTION 의 "백혈구 centroid 근처 박스에서 영양분 계속 부활" 메커니즘 복원.
//   options.cx/cy 생략 시 살아있는 백혈구 centroid 자동 (없으면 화면 중앙).
export function nutrientRegen(options: NutrientRegenOptions = {}): CutsceneStep {
  return { type: 'nutrientRegen', options };
}

// 게임: 화면의 모든 entity 정리 — 다음 이벤트 준비 (clean slate).
//   대상: 백혈구 (살아있음/시체 모두), 세균 (살아있음/시체), 대식세포, 영양분, 항체, 페이즈 2 풍선.
//   EntityRegistry control 은 유지 — 다음 step 에서 spawn 가능. 컷신 종료 시점엔 reset 됨.
//   즉시 advance.
export function clear(): CutsceneStep {
  return { type: 'clear' };
}

// 게임: 컷신 종료 마커 — 시퀀스 끝. BloodScene 가 placing/running 으로 전환.
export function end(): CutsceneStep {
  return { type: 'end' };
}

// 게임: 사용자 클릭 배치를 placementQueue 에 등록. 컷신/스테이지 종료 시점에 일괄로 placing 단계가
//   시작되어 큐 순서대로 처리됨. step 자체는 즉시 advance — 컷신 흐름 막지 않음.
//   예: place('tcell', 'T세포 (대장세포)')
//   기존 하드코딩된 3개 (TCELL/BACTERIA_COMMANDER/BCELL) 를 스크립터블하게 빼는 용도.
export function place(kind: EntityKind, label: string): CutsceneStep {
  return { type: 'place', kind, label };
}
