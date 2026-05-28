// 스테이지 클리어 특전 (perk) — 누적 영구 업그레이드.
//   스테이지 클리어 시 7종 중 랜덤 3개 제시 → 사용자 1개 선택 → PerkState 누적.
//   중첩 가능 (같은 특전 반복 = 배수 누적).
//
// 적용 레이어: EntityRegistry (컷신/디버그 제어) 와 별개. spawn / 시스템이 getPerkState() 참조.
//   scene.restart() 해도 유지되도록 module singleton — 게임 처음부터 시작 시 resetPerkState().
//
// Phaser 의존 0 (도메인 계층).

export type PerkId =
  | 'speed'          // 1. 호중구 이동속도 ↑
  | 'superChance'    // 2. 슈퍼호중구 발생확률 ↑
  | 'tcell'          // 3. 호중구대장(T세포) 초반 등장
  | 'bcell'          // 4. B세포 추가 + 초반 등장
  | 'nkChance'       // 5. NK세포 등장확률 ↑
  | 'hp'             // 6. 호중구 체력 ↑
  | 'nutrientRegen'; // 7. 영양분 리젠 ↓ (세균 약화)

// 게임: 누적 상태. 각 필드는 특전 선택마다 갱신.
//   배수 (mul) 는 ×, 가산 (bonus/count) 는 +.
export type PerkState = {
  speedMul: number;          // 호중구 속도 배수. 디폴트 1.
  superBonus: number;        // 슈퍼 생산 추가 확률 (0~). 디폴트 0.
  tcellCount: number;        // 스테이지 시작 T세포 자동 등장 수. 디폴트 0.
  bcellCount: number;        // 스테이지 시작 B세포 자동 등장 수. 디폴트 0.
  nkBonus: number;           // NK 생산 추가 확률 (0~). 디폴트 0.
  hpMul: number;             // 호중구 maxHp 배수. 디폴트 1.
  nutrientRegenMul: number;  // 영양분 부활 지연 배수 (클수록 느림 = 세균 약화). 디폴트 1.
};

// 게임: 특전 1회 선택 시 적용량. 누적 방식 (배수는 곱, 가산은 더함).
const PERK_STEP = {
  speedMul: 1.2,            // ×1.2 누적
  superBonus: 0.25,         // +0.25 누적
  tcellCount: 1,            // +1
  bcellCount: 1,            // +1
  nkBonus: 0.1,             // +0.1 누적
  hpMul: 1.25,              // ×1.25 누적
  nutrientRegenMul: 1.4,    // ×1.4 누적 (부활 간격 늘어남)
} as const;

// 게임: UI 표시용 정의 — 카드에 이름/설명.
export type PerkDef = { id: PerkId; name: string; desc: string };
export const PERK_DEFS: readonly PerkDef[] = [
  { id: 'speed',         name: '호중구 가속',     desc: '호중구 이동속도 +20%' },
  { id: 'superChance',   name: '슈퍼 호중구 촉진', desc: '슈퍼 호중구 발생확률 ↑' },
  { id: 'tcell',         name: 'T세포 증원',      desc: 'T세포(대장) 초반 등장 +1' },
  { id: 'bcell',         name: 'B세포 증원',      desc: 'B세포 초반 등장 +1' },
  { id: 'nkChance',      name: 'NK 동원',         desc: 'NK세포 등장확률 ↑' },
  { id: 'hp',            name: '호중구 강화',     desc: '호중구 체력 +25%' },
  { id: 'nutrientRegen', name: '영양분 고갈',     desc: '영양분 리젠 둔화 (세균 약화)' },
];

function freshPerkState(): PerkState {
  return {
    speedMul: 1,
    superBonus: 0,
    tcellCount: 0,
    bcellCount: 0,
    nkBonus: 0,
    hpMul: 1,
    nutrientRegenMul: 1,
  };
}

// 게임: module singleton — scene.restart() 넘어 유지.
let SHARED: PerkState = freshPerkState();

export function getPerkState(): PerkState {
  return SHARED;
}

// 게임: 게임 처음부터 시작 (첫 스테이지) 시 호출 — 누적 초기화.
export function resetPerkState(): void {
  SHARED = freshPerkState();
}

// 게임: 특전 1개 선택 적용 — 누적.
export function applyPerk(id: PerkId): void {
  switch (id) {
    case 'speed':         SHARED.speedMul *= PERK_STEP.speedMul; break;
    case 'superChance':   SHARED.superBonus += PERK_STEP.superBonus; break;
    case 'tcell':         SHARED.tcellCount += PERK_STEP.tcellCount; break;
    case 'bcell':         SHARED.bcellCount += PERK_STEP.bcellCount; break;
    case 'nkChance':      SHARED.nkBonus += PERK_STEP.nkBonus; break;
    case 'hp':            SHARED.hpMul *= PERK_STEP.hpMul; break;
    case 'nutrientRegen': SHARED.nutrientRegenMul *= PERK_STEP.nutrientRegenMul; break;
  }
}

// 게임: 7종 중 랜덤 N개 (기본 3) 선택 — 중복 없이. 중첩 정책상 매번 전체 풀에서 뽑음.
//   Fisher-Yates 부분 셔플. random 인자로 받아 테스트 deterministic.
export function pickRandomPerks(count = 3, random: () => number = Math.random): PerkDef[] {
  const pool = [...PERK_DEFS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

// ─── 스킬 충전 (호중구/세균 추가 호출) — 진짜 누적 모델 ────────────────────
//   기본 1 → 스테이지 클리어마다 +1 → 사용 시 -1 (이월). scene.restart 넘어 유지.
//   PerkState 와 같은 module singleton. 게임 처음 (stage 0) 진입 시 resetSkillCharges.
export type SkillCharges = { neutrophil: number; bacteria: number };
let SKILLS: SkillCharges = { neutrophil: 1, bacteria: 1 };

export function getSkillCharges(): SkillCharges {
  return SKILLS;
}

// 게임: 게임 처음부터 (첫 스테이지) — 각 1회로 초기화.
export function resetSkillCharges(): void {
  SKILLS = { neutrophil: 1, bacteria: 1 };
}

// 게임: 스테이지 클리어 → 다음 진입 시 각 +1.
export function addStageSkillCharges(): void {
  SKILLS.neutrophil += 1;
  SKILLS.bacteria += 1;
}

// 게임: 호중구 충전 소모. 남으면 -1 후 true, 없으면 false.
export function useNeutrophilCharge(): boolean {
  if (SKILLS.neutrophil <= 0) return false;
  SKILLS.neutrophil -= 1;
  return true;
}

// 게임: 세균 충전 소모.
export function useBacteriaCharge(): boolean {
  if (SKILLS.bacteria <= 0) return false;
  SKILLS.bacteria -= 1;
  return true;
}
