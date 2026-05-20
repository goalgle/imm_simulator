// INTRO 컷신 (Session 21). 게임 시작 시 1회. 스테이지 1 시작 전.
//
// 대본 형식 — 사용자가 직접 텍스트만 편집할 수 있도록 backtick multi-line 사용.
// 들여쓰기/빈 줄은 자동 무시. 라인 단위로 단어별 타이핑 → 라인 사이 짧은 pause → 클릭으로 다음 step.
//
// action(...) 호출은 BloodScene 의 ACTION 핸들러 (Stage B 에서 구현). 현재는 placeholder.

import { narration, action, end, type CutsceneStep } from './types';

export const CUTSCENE_INTRO: CutsceneStep[] = [
  narration(`
    캄캄하죠?
    당신의 혈관입니다.
    밤하늘이라고요?
    이또한 당신 안의 우주입니다.
  `),

  narration(`
    그리고...
    우주에는 별이 있죠.
  `),

  // 영양분 5개 순차 spawn + sparkle 후 잠시 정지.
  action('spawnNutrients'),

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

  // 세균 등장 → 영양분 흡수 → 분열 → 잠시 정지.
  action('spawnBacteria'),

  narration(`
    세균은 영양분을 먹으면 증식해요.
    이렇게 세균들이 마구 증식해서 영양분이 다 사라지면?
    네.. 다이어트 성공이죠.
    하지만 세상이 쉽지 않아요.
    당신의 다이어트를 방해하는 백혈구가 여기 등장!
  `),

  // 호중구 등장 → 세균 처치 또는 백혈구 사망 → 잠시 정지.
  action('spawnNeutrophils'),

  narration(`
    이렇게 됩니다. 떨어진건 고름이라 생각해주세요.
  `),

  narration(`
    백혈구는 세균을 막아야 하고
    세균은 백혈구를 피하며 영양분을 먹어야 해요.
    하지만 백혈구는 강하죠.
    세균을 좀 더 넣어볼까요?
  `),

  // 세균 5 추가 + 영양분 6개 새 위치 + 호중구 2 추가. 영양분 6개 다 사라지면 종료.
  action('reinforcement'),

  narration(`
    세균들은 모이면 리더를 세워요.
    그리고 리더는 똑똑하죠. 자신들도 백혈구를 이길 수 있다고 판단해요.
  `),

  end(),
];
