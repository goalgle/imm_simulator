// 스테이지 시스템 (Session 22 — 재구성).
// 기존 StageConfig (단순 데이터) → CutsceneStep 재사용 스크립터블 구조.
//
// 형식 (큰 그림):
//   1. title         — "STAGE N — 제목" 풀스크린 표시 (3초)
//   2. intro         — 짧은 narration / pause 시퀀스 (생략 가능)
//   3. setup         — 본게임 시작 시점 일괄 적용 (spawn / nutrientRegen / evolveCommander 등)
//   4. waves         — atSec 도달 시 step 들 실행 (주로 spawn)
//   5. endConditions — 매 프레임 검사. 첫 일치가 결과 (clear / wipe)
//   6. timeLimit 도달 → timeout 자동 평가 (stars.twoRatio / oneRatio 비율)
//
// CutsceneStep 재사용 — narration / spawn / control / pause / nutrientRegen / evolveCommander 등이
// 그대로 동작. waves 안 narration 은 메인 게임 흐름을 막지 않도록 런타임에서 skip.
//
// Phaser 의존 0 — 도메인 계층.

import type { CutsceneStep } from '../cutscenes/types';

// 게임: 시간 흐름 이벤트 — atSec 도달 시 steps 일괄 실행. atSec 오름차순 권장 (코드는 정렬 X).
//   steps 안 narration 은 skip (메인 게임 흐름 막지 않도록). spawn / nutrientRegen / control 가 주 용도.
export type StageWave = {
  atSec: number;
  steps: CutsceneStep[];
};

// 게임: 종료 조건. 검사 순서가 우선순위 — 매 프레임 위→아래, 첫 일치가 결과.
//   기존 WaitCondition 와 같은 enum + 미래 확장 여지.
export type StageEndCheck =
  | 'bacteriaEliminated'
  | 'whiteCellsEliminated'
  | 'neutrophilsEliminated';

export type StageEndCondition = {
  check: StageEndCheck;
  result: 'clear' | 'wipe';
};

// 게임: 별점 임계 — timeout 시 killed/total 비율로 결정.
//   비율 ≥ twoRatio → ★★, ≥ oneRatio → ★, 미만 → 실패 (★0).
//   clear (wave 다 처리 + 세균 0) 는 항상 ★3.
export type StageStars = {
  twoRatio: number;
  oneRatio: number;
};

export type StageConfig = {
  id: string;
  title: string;
  // 게임: 스테이지 진입 시 짧은 intro 컷신. 생략 가능 (빈 배열).
  //   end() 는 자동 처리 — 작성자는 narration / spawn / pause 등만 나열.
  intro: CutsceneStep[];
  // 게임: 본게임 시작 시점 일괄 셋업. 즉시 실행 (narration / waitFor 은 의미 없음).
  //   주 용도: spawn (호중구/세균/대식세포), nutrientRegen, evolveCommander, control.
  setup: CutsceneStep[];
  // 게임: 시간 흐름 이벤트 — atSec 오름차순 권장.
  waves: StageWave[];
  // 게임: 시간 제한 (초, gameTime 기준). 도달 시 자동 timeout.
  timeLimit: number;
  // 게임: 종료 조건 (timeout 외). 검사 순서가 우선순위.
  endConditions: StageEndCondition[];
  // 게임: 별점 임계.
  stars: StageStars;
};

// 게임: 스테이지 결과.
export type StageResult =
  | { kind: 'clear'; stars: 3; killed: number; total: number; elapsedSec: number }
  | { kind: 'timeout'; stars: 0 | 1 | 2; killed: number; total: number }
  | { kind: 'wipe'; stars: 0; killed: number; total: number; elapsedSec: number };
