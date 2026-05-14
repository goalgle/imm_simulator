// 스테이지 시스템 (Session 20).
// 시간 제한 안에 세균 전멸 = 시간 클리어 (★★★). 시간 초과 = 잡은 비율 평가 (★★/★).
// 호중구 (NEUTROPHIL/NK/SUPER) 전멸 = 즉시 패배.
//
// Phaser 의존 0 — 도메인 계층. BloodScene 이 import 해서 게임 상태로 사용.

// 게임: 세균 wave 1개 — 게임 시작 atSec 초에 추가 spawn. timeLimit 안 등장 스케줄링.
export type StageBacteriaWave = {
  atSec: number;             // 게임 시작 (gameTime=0) 기준 등장 시각
  bacteria: number;          // 일반 세균 추가 수
  commander?: number;        // 커맨더 추가 수 (0 또는 생략 = 추가 X)
};

export type StageConfig = {
  id: string;
  name: string;
  timeLimit: number;         // 초. gameTime 기준 — speedMultiplier 영향 자동 반영.
  // 시작 spawn 수 (gameTime=0 시점)
  startNeutrophils: number;
  startBacteria: number;
  startBacteriaCommanders: number;
  // 세균 wave 스케줄 — atSec 오름차순 권장 (코드는 정렬 X — 데이터 작성자 책임).
  bacteriaWaves: StageBacteriaWave[];
  // 별 평가 비율 임계 (시간 초과 시) — killed / (start + waves 총합).
  starTwoRatio: number;      // 이 비율 이상 = ★★
  starOneRatio: number;      // 이 비율 이상 = ★ (미만 = 실패)
};

// 게임: 스테이지 결과 — 시간 클리어 / 시간 초과 / 호중구 전멸.
export type StageResult =
  | { kind: 'clear'; stars: 3; killed: number; total: number; elapsedSec: number }
  | { kind: 'timeout'; stars: 0 | 1 | 2; killed: number; total: number }
  | { kind: 'wipe'; stars: 0; killed: number; total: number; elapsedSec: number };

// 게임: 첫 스테이지 — 권장 명세 (Session 20).
//   180s 안 13마리 (3 시작 + 5+5 wave) 처리. 커맨더 1마리.
//   별 ★★: 80%+, ★: 50%+.
export const STAGE_1: StageConfig = {
  id: 'stage-1',
  name: '튜토리얼: 첫 침입',
  timeLimit: 180,
  startNeutrophils: 10,
  startBacteria: 3,
  startBacteriaCommanders: 1,
  bacteriaWaves: [
    { atSec: 60, bacteria: 5 },
    { atSec: 120, bacteria: 5 },
  ],
  starTwoRatio: 0.8,
  starOneRatio: 0.5,
};
