// 10 스테이지 정의 (Session 22).
// 호중구 입장에서의 난이도 — 후반으로 갈수록 호중구 ↓, 세균/커맨더/감염 ↑.
//
// 조정 축:
//   - startNeutrophils (감소)         — 5에서 시작 → 3 까지
//   - startBacteria (증가)            — 3 → 12
//   - startBacteriaCommander (증가)   — 1 → 3
//   - macrophage (증감)               — 1 → 3 (후반 도움) 또는 0 (난이도 ↑)
//   - nutrientRegen.half (감소)       — 200 → 70 (좁고 빠른 부활 영역)
//   - nutrientRegen.initialCount      — 8 → 15
//   - wave.infectedChance (증가)      — 0% → 100%
//   - timeLimit (점진 증가)           — 180 → 220
//
// 작성자가 텍스트만 편집할 수 있도록 cutscene helper 직접 import.

import { narration, spawn, place, pause, nutrientRegen } from '../cutscenes/types';
import type { StageConfig } from './types';

// 게임: 모든 스테이지에 공통인 종료 조건 (현재 디자인).
const COMMON_END: StageConfig['endConditions'] = [
  { check: 'bacteriaEliminated',  result: 'clear' },
  { check: 'neutrophilsEliminated', result: 'wipe' },
];

// 게임: 모든 스테이지 공통 별점 임계 (현재 디자인).
const COMMON_STARS: StageConfig['stars'] = { twoRatio: 0.8, oneRatio: 0.5 };

// ─── 스테이지 1: 튜토리얼 진입 ────────────────────────────────────────
export const STAGE_1: StageConfig = {
  id: 'stage-1',
  title: '첫 침입',
  intro: [
    narration(`
      적은 적은 수.
      호중구도 충분합니다.
      여유롭게 막아보세요.
    `),
  ],
  setup: [
    spawn('neutrophil', 10, { spread: 300 }),
    spawn('bacteria', 3, { spread: 200 }),
    spawn('bacteriaCommander', 1),
    spawn('macrophage', 1),
    nutrientRegen({ half: 200, initialCount: 8 }),
  ],
  waves: [
    { atSec: 60,  steps: [spawn('bacteria', 5, { spread: 250 })] },
    { atSec: 120, steps: [spawn('bacteria', 5, { spread: 250 })] },
  ],
  timeLimit: 180,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 2: 영양분 풍부 ──────────────────────────────────────────
export const STAGE_2: StageConfig = {
  id: 'stage-2',
  title: '영양분 풍부',
  intro: [
    narration(`
      혈장 영양분이 늘었어요.
      세균이 빠르게 증식할 수 있는 환경입니다.
    `),
  ],
  setup: [
    spawn('neutrophil', 9, { spread: 300 }),
    spawn('bacteria', 4, { spread: 200 }),
    spawn('bacteriaCommander', 1),
    spawn('macrophage', 1),
    nutrientRegen({ half: 180, initialCount: 10 }),
  ],
  waves: [
    { atSec: 50,  steps: [spawn('bacteria', 5, { spread: 250 })] },
    { atSec: 110, steps: [spawn('bacteria', 5, { spread: 250 })] },
  ],
  timeLimit: 180,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 3: 두 지휘관 ────────────────────────────────────────────
export const STAGE_3: StageConfig = {
  id: 'stage-3',
  title: '두 지휘관',
  intro: [
    narration(`
      적 지휘관이 둘이에요.
      각자의 무리를 이끌어 협공해옵니다.
    `),
  ],
  setup: [
    place('tcell', 'T세포 (대장세포)'),
    spawn('neutrophil', 9, { spread: 300 }),
    spawn('bacteria', 4, { spread: 200 }),
    spawn('bacteriaCommander', 2, { spread: 200 }),
    spawn('macrophage', 1),
    nutrientRegen({ half: 160, initialCount: 10 }),
  ],
  waves: [
    { atSec: 60,  steps: [spawn('bacteria', 4, { spread: 250 })] },
    { atSec: 120, steps: [spawn('bacteria', 4, { spread: 250 })] },
  ],
  timeLimit: 180,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 4: 보강 또 보강 ────────────────────────────────────────
export const STAGE_4: StageConfig = {
  id: 'stage-4',
  title: '보강 또 보강',
  intro: [
    narration(`
      이번엔 보강이 세 번에 걸쳐 옵니다.
      대식세포가 한 마리 더 합류했어요.
    `),
  ],
  setup: [
    place('bacteriaCommander', '세균 커맨더'),
    spawn('neutrophil', 8, { spread: 300 }),
    spawn('bacteria', 4, { spread: 200 }),
    spawn('macrophage', 2),
    nutrientRegen({ half: 150, initialCount: 10 }),
  ],
  waves: [
    { atSec: 50,  steps: [spawn('bacteria', 4, { spread: 250 })] },
    { atSec: 100, steps: [spawn('bacteria', 5, { spread: 250 })] },
    { atSec: 150, steps: [spawn('bacteria', 5, { spread: 250 })] },
  ],
  timeLimit: 200,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 5: 첫 변종 ──────────────────────────────────────────────
export const STAGE_5: StageConfig = {
  id: 'stage-5',
  title: '첫 변종',
  intro: [
    narration(`
      바이러스에 감염된 세균이 보입니다.
      호중구가 잡으면 변이가 일어날 수 있어요.
    `),
  ],
  setup: [
    place('bcell', 'B세포'),
    spawn('neutrophil', 8, { spread: 300 }),
    spawn('bacteria', 4, { spread: 200 }),
    spawn('bacteriaCommander', 1),
    spawn('macrophage', 2),
    nutrientRegen({ half: 140, initialCount: 10 }),
  ],
  waves: [
    { atSec: 60,  steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.3 })] },
    { atSec: 120, steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.3 })] },
  ],
  timeLimit: 200,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 6: 다중 지휘관 ──────────────────────────────────────────
export const STAGE_6: StageConfig = {
  id: 'stage-6',
  title: '다중 지휘',
  intro: [
    narration(`
      지휘관 두 명에 보강도 거셉니다.
      대식세포 도움을 잘 활용하세요.
    `),
  ],
  setup: [
    spawn('neutrophil', 7, { spread: 300 }),
    spawn('bacteria', 5, { spread: 200 }),
    spawn('bacteriaCommander', 2, { spread: 200 }),
    spawn('macrophage', 2),
    nutrientRegen({ half: 130, initialCount: 12 }),
  ],
  waves: [
    { atSec: 55,  steps: [spawn('bacteria', 6, { spread: 250, infectedChance: 0.2 })] },
    { atSec: 115, steps: [spawn('bacteria', 6, { spread: 250, infectedChance: 0.2 })] },
  ],
  timeLimit: 200,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 7: 폭주하는 변종 ────────────────────────────────────────
export const STAGE_7: StageConfig = {
  id: 'stage-7',
  title: '폭주하는 변종',
  intro: [
    narration(`
      감염된 세균이 절반을 넘어요.
      어떤 변이가 등장할지 모르니 조심하세요.
    `),
  ],
  setup: [
    place('tcell', 'T세포 (대장세포)'),
    place('bacteriaCommander', '세균 커맨더'),
    place('bcell', 'B세포'),
    spawn('neutrophil', 6, { spread: 300 }),
    spawn('bacteria', 5, { spread: 200 }),
    spawn('bacteriaCommander', 1, { spread: 200 }),
    spawn('macrophage', 2),
    nutrientRegen({ half: 120, initialCount: 12 }),
  ],
  waves: [
    { atSec: 50,  steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.5 })] },
    { atSec: 110, steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.5 })] },
    { atSec: 170, steps: [spawn('bacteria', 4, { spread: 250, infectedChance: 0.5 })] },
  ],
  timeLimit: 220,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 8: 무한 보강 ────────────────────────────────────────────
export const STAGE_8: StageConfig = {
  id: 'stage-8',
  title: '무한 보강',
  intro: [
    narration(`
      네 번에 걸친 보강이 들어옵니다.
      대식세포 셋이 든든하지만 청소가 만만치 않을 거예요.
    `),
  ],
  setup: [
    spawn('neutrophil', 5, { spread: 300 }),
    spawn('bacteria', 6, { spread: 200 }),
    spawn('bacteriaCommander', 2, { spread: 200 }),
    spawn('macrophage', 3),
    nutrientRegen({ half: 110, initialCount: 12 }),
  ],
  waves: [
    { atSec: 45,  steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.4 })] },
    { atSec: 95,  steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.4 })] },
    { atSec: 145, steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.4 })] },
    { atSec: 195, steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.4 })] },
  ],
  timeLimit: 220,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 9: 절체절명 ─────────────────────────────────────────────
export const STAGE_9: StageConfig = {
  id: 'stage-9',
  title: '절체절명',
  intro: [
    narration(`
      호중구가 부족합니다.
      대식세포가 새 호중구를 생산하기를 기다리세요.
    `),
    pause(0.5),
    narration(`
      파동(클릭) 으로 호중구를 위협 지역으로 보낼 수도 있어요.
    `),
  ],
  setup: [
    spawn('neutrophil', 4, { spread: 300 }),
    spawn('bacteria', 8, { spread: 200 }),
    spawn('bacteriaCommander', 3, { spread: 200 }),
    spawn('macrophage', 3),
    nutrientRegen({ half: 100, initialCount: 14 }),
  ],
  waves: [
    { atSec: 45, steps: [spawn('bacteria', 6, { spread: 250, infectedChance: 0.7 })] },
    { atSec: 100, steps: [spawn('bacteria', 6, { spread: 250, infectedChance: 0.7 })] },
    { atSec: 160, steps: [spawn('bacteria', 6, { spread: 250, infectedChance: 0.7 })] },
  ],
  timeLimit: 220,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// ─── 스테이지 10: 최후의 전투 ─────────────────────────────────────────
export const STAGE_10: StageConfig = {
  id: 'stage-10',
  title: '최후의 전투',
  intro: [
    narration(`
      가장 험난한 침입.
      마지막 호중구들이 자가 융합과 진화로 버텨야 합니다.
    `),
  ],
  setup: [
    spawn('neutrophil', 3, { spread: 300 }),
    spawn('bacteria', 10, { spread: 200 }),
    spawn('bacteriaCommander', 3, { spread: 200 }),
    spawn('macrophage', 3),
    nutrientRegen({ half: 90, initialCount: 15 }),
  ],
  waves: [
    { atSec: 30,  steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.7 })] },
    { atSec: 70,  steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.8 })] },
    { atSec: 110, steps: [spawn('bacteria', 5, { spread: 250, infectedChance: 0.9 })] },
    { atSec: 160, steps: [spawn('bacteria', 8, { spread: 250, infectedChance: 1.0 })] },
  ],
  timeLimit: 220,
  endConditions: COMMON_END,
  stars: COMMON_STARS,
};

// 게임: 순차 스테이지 배열. 인덱스 = 스테이지 번호 - 1.
//   BloodScene 이 currentStageIndex 로 조회. 클리어 시 +1, 10번 도달 시 게임 종료.
export const STAGES: readonly StageConfig[] = [
  STAGE_1, STAGE_2, STAGE_3, STAGE_4, STAGE_5,
  STAGE_6, STAGE_7, STAGE_8, STAGE_9, STAGE_10,
];
