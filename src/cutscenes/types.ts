// 컷신 시스템 (Session 21). 게임 시작 시 대본 형태로 객체/시스템을 소개.
//
// 사용:
//   import { narration, action, end } from './types';
//   export const MY_CUTSCENE = [
//     narration(`
//       첫번째 라인.
//       두번째 라인.
//     `),
//     action('spawnNutrients'),
//     narration(`다음 텍스트.`),
//     end(),
//   ];
//
// 동작:
//   - narration: 단어별 타이핑 + 클릭으로 다음. 여러 줄 = 자동 진행 (라인 사이 짧은 pause).
//   - action: 코드로 정의된 액션 (spawn/sim 진행 등). 끝나면 자동 다음 step.
//   - end: 컷신 종료. placing 또는 running 으로 전환.
//
// Phaser 의존 0 — 도메인 계층. BloodScene 이 import 해서 시퀀스 해석.

export type CutsceneStep =
  | { type: 'narration'; lines: string[] }
  | { type: 'action'; kind: string }
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

// 게임: 액션 step — kind 는 BloodScene 의 ACTION 핸들러 키. Stage A 는 placeholder 처리.
//   현재 정의된 kind: 'spawnNutrients' | 'spawnBacteria' | 'spawnNeutrophils' (Stage B 에서 구현)
export function action(kind: string): CutsceneStep {
  return { type: 'action', kind };
}

// 게임: 컷신 종료 마커 — 시퀀스 끝. BloodScene 가 placing/running 으로 전환.
export function end(): CutsceneStep {
  return { type: 'end' };
}
