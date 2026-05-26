// INTRO 컷신 (Session 21 → 단계 6 마이그레이션). 게임 시작 시 1회. 스테이지 1 시작 전.
//
// 단계 6 (2026-05-21): 기존 action('spawnNutrients') 등 ACTION 핸들러 → 선언적
//   control() / spawn() / pause() 조합으로 마이그레이션. 대본 자체가 "무엇이 등장하는가" 를 표현.
//
// 대본 형식 — 사용자가 텍스트만 편집할 수 있도록 backtick multi-line. 들여쓰기/빈 줄 자동 무시.
// 라인 단위로 단어별 타이핑 → 라인 사이 짧은 pause → 클릭으로 다음 step.

import { narration, warning, control, spawn, place, pause, waitFor, waitForShockwaves, waitForBacteriaKilled, waitForMacrophageProductions, evolveCommander, nutrientRegen, clear, end, type CutsceneStep } from './types';

export const CUTSCENE_INTRO: CutsceneStep[] = [
  // 게임: 인트로 진입 시 모든 종 비활성. 각 step 이 필요한 것만 enabled 로.
  //   control 들은 즉시 적용되고 다음 step 으로 진행 (timer 없음).
  control('nutrient',  { enabled: false }),
  control('bacteria',  { enabled: false, frozen: true }),
  control('neutrophil', { enabled: false }),

  narration(`
    캄캄하죠?
    밤하늘같다고요?
    당신의 혈관입니다.
    이또한 당신 안의 우주죠.
  `),

  narration(`
    그리고...
    우주에는 별이 이렇게.
  `),

  // event : 영양분 소개
  // 영양분 5개 — 등장 허용 후 순차 spawn + 1s sparkle 펄스 + 짧은 호흡.
  //   sparkleSeconds: spawn 완료 후 그 시간만큼 spawn 위치에 노란 원 펄스 (반지름 ↑ alpha ↓).
  control('nutrient', { enabled: true }),
  spawn('nutrient', 5, { spread: 60, interval: 0.5, sparkleSeconds: 1.0 }),
  pause(0.6),

  narration(`
    아 물론 여기는 혈관이니 이건 별이 아니라 혈장속 영양분입니다.
    움직이지 않는듯 보이지만 우리는 지금 거대한 혈류를 타고 있는거에요.
  `),

  narration(`
    왜 뜬금없이 영양분인가?
    하면.. 세균이 먹고 증식해야 하니까요.
    ... 당신은 이미 충분히 잘 먹고 있잖아.
    ...
    ...
  `),

  narration(`
    때때로 외부 상처를 통해 세균이 침입할 수 있어요.
  `),

  // event : 세균 소개  
  // 세균 2마리 — 등장 허용 + frozen 해제 + 화면 중앙 박스에 spawn.
  //   영양분 5개 모두 흡수/분열될 때까지 대기 (max 15s).
  control('bacteria', { enabled: true, frozen: false }),
  spawn('bacteria', 2, { spread: 80 }),
  waitFor('nutrientsConsumed', 15),

  narration(`
    세균은 영양분을 먹으면 증식해요.
    마구 증식해서 영양분이 다 사라지면?
    네.. 다이어트 성공이죠.
    하지만 세상이 쉽지 않아요.
    당신의 다이어트를 방해하는 백혈구가 여기 등장!
  `),

  // 호중구 1마리 — 세균 frozen 다시 켜서 그 사이 도주 차단.
  //   호중구가 정지된 세균 2마리 잡으면 (max 15s) → 2초 호흡 → 다음 step.
  //   이 시연 동안만 호중구 속도 ×2 — 시연 호흡 단축. 다음 step 전 1.0 으로 복구.
  control('bacteria', { frozen: true }),
  control('neutrophil', { enabled: true, speedMul: 2 }),
  spawn('neutrophil', 1, { spread: 0 }),
  waitForBacteriaKilled(2, 15),
  pause(2),
  control('neutrophil', { speedMul: 1 }),

  narration(`
    떨어진건 죽은 세포로 고름이됩니다.
    그리고 싸우면 약해져요. 작아지고 느려지죠.
  `),

  narration(`
    세균은 영양분을 먹어야 해요.
    하지만 백혈구는 세균을 막아서고 강하죠.
    세균을 좀 더 넣어볼까요?
  `),

  // 보강 — 세균 frozen 해제 + 5마리 추가 + 호중구 2마리 추가 + 영양분 박스 부활 활성화.
  //   세균/호중구가 자유롭게 활동 — 자연 전투 발생.
  //   nutrientRegen({ half: 80 }): 살아있는 백혈구 centroid 근처 ±80 박스에 영양분 6개 활성화
  //     + 흡수돼도 같은 박스 안 새 위치에 부활 (frozen 해제). 세균이 영양분 먹으려면 백혈구 영역 진입 필요.
  //   evolveCommander(2): 2초 후 일반 세균 1마리가 커맨더로 진화 (자가 균형 메커니즘).
  //   호중구류 (NEUTROPHIL/NK/SUPER) 전멸까지 대기 (max 30s).
  //   "백혈구가 세균에게 진다" 시연 — max 안에 안 죽어도 30s 후 강제 진행.
  control('bacteria', { frozen: false }),
  spawn('bacteria', 5, { spread: 200 }),
  spawn('neutrophil', 2, { spread: 200 }),
  nutrientRegen({ half: 80, initialCount: 6 }),
  evolveCommander(2),
  waitFor('neutrophilsEliminated', 30),

  narration(`
    붉은 세균을 봤나요? 리더입니다.
    주변 세균들을 조정해요. 카리스마있죠.
    그리고 호중구를 공격하게 해요!
    개체는 살고싶지만 군집의 결정은 희생을 강요하는 세상의 이치란..
  `),

  // 게임: 화면 정리 + 2초 호흡 — 컷신 → 본 스테이지 전환을 부드럽게.
  clear(),
  pause(2),

  narration(`
    바닥에 떨어진 고름은
    대식세포가 돌다아니며 청소해요.
    그리고 양분으로 재활용하여 호중구를 생성해요.
  `),

  // event : 대식세포 소개
  // 등장 : 호중구 7, 세균 15, 대식세포 1
  // 환경 : 세균커맨더 허용, 영양분 계속 생성, 대식세포의 세포 생성 허용
  // 종료 : 대식세포가 호중구 3마리 생산할 때까지 (max 60s).
  spawn('neutrophil', 7, { spread: 300 }),
  spawn('bacteria', 15, { spread: 300 }),
  spawn('macrophage', 1, { spread: 0 }),
  control('bacteria', { frozen: false }),
  // 세균 20마리 이상 시 영양분 리젠 ½ (부활 간격 2배) — 분열 폭주 억제.
  nutrientRegen({
    half: 120,
    initialCount: 8,
    slowWhenBacteriaAbove: { count: 20, regenMul: 0.5 },
  }),
  evolveCommander(3), // 3초 후 일반 세균 1마리 → 커맨더 자연 진화 트리거
  waitForMacrophageProductions(3, 60),

  pause(2),

  warning(`
    주의! 실제로 대식세포는 세포 생산이나 분열을 못해요.
    게임적 허용이라 봐주세요.
  `),

  clear(),

  narration(`
    지금까지 멍때리고 보기만 하셨다면
    속으로 호중구를 응원했나요? 세균을 응원했나요?
    당연히 호중구를... 응? 아니야??
    ...
  `),
  pause(1),
  narration(`
    호중구가 좀 느려서 답답할 수 있어요.
    화면 어딘가를 툭 쳐보세요. 파동이 생겨요.
    이름하여 파!동!지?
    이 파동을 타고 호중구는 좀 더 빠르게 이동할 수 있어요.
  `),

  // event : 파동 인터렉션 소개
  // 등장 : 호중구 5, 세균 10, 대식세포 1
  // 환경 : 파동(충격파) 인터렉션 허용. 영양분 계속 생성(세균 15되면 ½ 리젠). 세균커맨더 등장 허용.
  //   waitForShockwaves step 동안 화면 탭 = 충격파 발사 (이 step 한정 인터렉션).
  // 종료 : 사용자가 충격파 6번 이상 발사 (max 60s 안전망).
  spawn('neutrophil', 5, { spread: 250 }),
  spawn('bacteria', 10, { spread: 250 }),
  spawn('macrophage', 1, { spread: 0 }),
  control('bacteria', { frozen: false }),
  nutrientRegen({
    half: 100,
    initialCount: 6,
    slowWhenBacteriaAbove: { count: 15, regenMul: 0.5 },
  }),
  evolveCommander(3),
  waitForShockwaves(6, 60),

  // 게임: 컷신 종료 직전 사용자 배치 등록 — 컷신 끝나면 placing 단계에서 큐 순서대로 클릭 배치.
  //   Session 22 — 기존 BloodScene 하드코딩 3개 → place() step 으로 이전.
  place('tcell', 'T세포 (대장세포)'),
  place('bacteriaCommander', '세균 커맨더'),
  place('bcell', 'B세포'),

  end(),
];
