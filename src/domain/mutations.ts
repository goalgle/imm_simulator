// 바이러스 변이 — 호중구 DNA 를 6종 변이 중 하나로 변형.
// 시스템 구현 기획서 §2.12 — 페이즈 2 wave 종결 시 hit 카운트로 변이 종류 결정 후 적용.
//
// 모든 변이 함수는 **새 DNA 를 반환** — 입력 dna 는 변형 안 함 (immutability).
//   호스트별 DNA 클론을 받은 뒤 거기에 적용되도록 호출자가 처리.
//
// ⚠️ 도메인 vs 시스템 분리 (Session 17 재정의):
//   각 변이의 "메커니즘" 은 페이즈 1 시스템 (ContactSystem, WhiteCellBehaviorSystem,
//   MacrophageSystem, BloodScene 등) 에 분기로 구현됨. 시스템은 `WhiteCell.mutation`
//   필드로 어떤 변이인지 식별. 본 파일은 dna 의 시각/기본 행동 형질만 변경.
//
//   예: 암세포는 "정지 + 바닥 낙하 + 분열" — 행동 자체는 시스템에서. dna 는 색 어두움만.
//       마비는 "3s 주기 0.5s 정지" — timer 는 시스템에서. dna 는 색 밝은 파랑만.
//
// 이 파일은 Phaser 의존 없음 (도메인 계층).

import type { DNA } from './dna';
import { cloneDna } from './dna';

// 게임: cloneDna 를 dna.ts 로 이동. 외부 코드와의 back-compat 위해 재내보냄.
export { cloneDna };

export type MutationKind =
  | 'zombie'       // 변이 1 — 호중구 우선 공격, fusion X, 호중구 vs 공격력 ×2
  | 'cancer'       // 변이 2 — 정지 + 바닥 낙하 + 일정 시간 후 좌우 분열
  | 'corruption'   // 변이 3 — 격렬 떨림 + scale 점감 + 소멸 시 페이즈 2 자동 진입
  | 'hyperactive'  // 변이 4 — 격렬 떨림 + scale 점증 + 폭발 (영역 데미지)
  | 'paralysis'    // 변이 5 — 일반 동작 + 3s 주기 0.5s 마비 (인접 호중구 전파)
  | 'chaos';       // 변이 6 — 공격력 ×3, 호중구/세균 무차별 공격, 모든 형질 랜덤

// 게임: 변이 1 — 좀비.
//   dna 변경: target=-1 (drives 가 동족 호중구를 prey 로 인식), 녹색 (식별), 떨림 ↓, 이동 속도 ↓.
//   시스템 분기 (Stage 11):
//     - ContactSystem: 호중구↔호중구 페어 검사, zombie 공격력 ×2 (호중구 vs). 양쪽 데미지 (싸우면 받음).
//     - WhiteCellBehaviorSystem: zombie 호중구는 fusion 후보에서 제외, prey 후보 = 살아있는 백혈구
//     - 세균과 접촉 시는 일반 호중구와 동일 (정상 데미지)
export function mutationZombie(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.behavior.target = -1.0;
  m.behavior.speed *= 0.6;
  m.color.h = 120;
  m.color.s = 40;
  m.shape.w1.omega *= 0.6;
  m.shape.w2.omega *= 0.6;
  return m;
}

// 게임: 변이 2 — 암세포.
//   dna 변경: 색 어두움만. **모양/떨림 유지** (사용자 디자인: 모양 유지한 채 바닥 낙하).
//   시스템 분기 (Stage 12 예정):
//     - WhiteCell: mutation==='cancer' 면 updateAlive 분기 — 행동 정지, 즉시 큰 Y (바닥) 으로 낙하
//     - 분열 timer (~6s) → 좌우로 새 암세포 spawn (양쪽 임펄스)
//     - MacrophageSystem: 대식세포 좌우 이동 경로에 암세포 충돌 → 정지 / 우회
export function mutationCancer(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.color.l = 40;
  return m;
}

// 게임: 변이 3 — 붕괴.
//   dna 변경: 진폭 반전 + 기괴한 주파수 + 빨강 + 빠른 속도. 격렬한 시각.
//   시스템 분기 (Stage 13 예정):
//     - WhiteCell: mutation==='corruption' 이면 매 프레임 scale 점감 (5s 동안 1 → 0)
//     - scale 0 도달 시 자기 소멸 + BloodScene 에 페이즈 2 자동 진입 시그널 (다른 호중구 호스트로)
export function mutationCorruption(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.shape.w1.A *= -0.8;
  m.shape.w2.n = 13;
  m.shape.w3.n = 7;
  m.color.h = 0;
  m.color.s = 80;
  m.behavior.speed *= 1.3;
  return m;
}

// 게임: 변이 4 — 과민.
//   dna 변경: 떨림 ×3 + 주황. 격렬한 시각.
//   시스템 분기 (Stage 14 예정):
//     - WhiteCell: mutation==='hyperactive' 이면 매 프레임 scale 점증 (4s 동안 1 → 2.5)
//     - 임계 도달 시 폭발: 반경 ~200px 내 살아있는 호중구/세균 모두 즉사 + 본인도 소멸
//     - 폭발 시각 (큰 펄스 + 화면 흔들림) 은 폴리싱
export function mutationHyperactive(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.shape.w1.omega *= 3.0;
  m.shape.w2.omega *= 3.0;
  m.shape.w3.omega *= 3.0;
  m.color.h = 45;
  m.color.s = 90;
  return m;
}

// 게임: 변이 5 — 마비.
//   dna 변경: 색 밝은 파랑만. **속도/떨림 정상** (사용자 디자인: 일반 호중구처럼 동작).
//   시스템 분기 (Stage 15 예정):
//     - WhiteCell: mutation==='paralysis' 이면 3s 주기로 0.5s 마비 timer
//     - 마비 활성 시 행동 시스템 입력 무시 (정지)
//     - 마비 활성 시 인접 호중구 (~60px) 도 0.5s 마비로 전파
export function mutationParalysis(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.color.h = 210;
  m.color.l = 80;
  return m;
}

// 게임: 변이 6 — 카오스.
//   dna 변경: 모든 형질 랜덤화 + 이동 속도 ×2. random 함수 인자로 받음 (테스트 deterministic).
//   시스템 분기 (Stage 11):
//     - ContactSystem: mutation==='chaos' 면 호중구↔호중구 + 호중구↔세균 모두 공격, 데미지 ×3
//     - WhiteCellBehaviorSystem: prey 후보 = 호중구 + 세균 중 가까운 것
export function mutationChaos(dna: DNA, random: () => number = Math.random): DNA {
  const m = cloneDna(dna);
  // shape.n 랜덤 2~15
  m.shape.w1.n = 2 + Math.floor(random() * 14);
  m.shape.w2.n = 2 + Math.floor(random() * 14);
  m.shape.w3.n = 2 + Math.floor(random() * 14);
  // shape.omega 랜덤 0.5~5.0
  m.shape.w1.omega = 0.5 + random() * 4.5;
  m.shape.w2.omega = 0.5 + random() * 4.5;
  m.shape.w3.omega = 0.5 + random() * 4.5;
  // behavior.target 랜덤 -1~1
  m.behavior.target = random() * 2 - 1;
  // 게임: 이동 속도 ×2 — 좀비(×0.6) 와 대비되는 빠른 무차별 공격자.
  m.behavior.speed *= 2.0;
  // color 랜덤
  m.color.h = random() * 360;
  m.color.s = 50 + random() * 50;
  return m;
}

// 게임: 10발 wave 의 hit 카운트 → 변이 종류 결정 (deterministic).
//   기획서 §2.12 의 매핑 표.
//     0     → null (정상, 변이 없음)
//     1~2   → zombie
//     3~4   → cancer
//     5~6   → corruption
//     7~8   → hyperactive
//     9     → paralysis
//     10    → chaos
//   hits 가 음수거나 10 초과면 clamp.
export function pickMutation(hits: number): MutationKind | null {
  if (hits <= 0) return null;
  if (hits <= 2) return 'zombie';
  if (hits <= 4) return 'cancer';
  if (hits <= 6) return 'corruption';
  if (hits <= 8) return 'hyperactive';
  if (hits <= 9) return 'paralysis';
  return 'chaos';
}

// 게임: kind 에 해당하는 변이 함수 디스패치. 호출자 편의용 헬퍼.
export function applyMutation(dna: DNA, kind: MutationKind, random?: () => number): DNA {
  switch (kind) {
    case 'zombie':       return mutationZombie(dna);
    case 'cancer':       return mutationCancer(dna);
    case 'corruption':   return mutationCorruption(dna);
    case 'hyperactive':  return mutationHyperactive(dna);
    case 'paralysis':    return mutationParalysis(dna);
    case 'chaos':        return mutationChaos(dna, random);
  }
}
