// 바이러스 변이 — 호중구 DNA 를 6종 변이 중 하나로 변형.
// 시스템 구현 기획서 §2.12 — 페이즈 2 wave 종결 시 hit 카운트로 변이 종류 결정 후 적용.
// 아이디어 기획서 §"바이러스 변이 시나리오 (총 6종)" 의 JS 명세를 TS 로 포팅.
//
// 모든 변이 함수는 **새 DNA 를 반환** — 입력 dna 는 변형 안 함 (immutability).
//   호스트별 DNA 클론을 받은 뒤 거기에 적용되도록 호출자가 처리.
//
// 이 파일은 Phaser 의존 없음 (도메인 계층).

import type { DNA } from './dna';
import { cloneDna } from './dna';

// 게임: cloneDna 를 dna.ts 로 이동. 외부 코드와의 back-compat 위해 재내보냄.
export { cloneDna };

export type MutationKind =
  | 'zombie'       // 변이 1 — 아군 공격 (target=-1, 녹색, 느린 떨림)
  | 'cancer'       // 변이 2 — 무한 증식 (분열↑, 비대화, 어두움)
  | 'corruption'   // 변이 3 — 형태 붕괴 (진폭 반전, 빨강, 빠름)
  | 'hyperactive'  // 변이 4 — 과민 반응 (떨림 ×3, 주황)
  | 'paralysis'    // 변이 5 — 마비 (거의 정지, 밝은 파랑)
  | 'chaos';       // 변이 6 — 카오스 (랜덤 모든 형질)

// 게임: 변이 1 — 좀비. 아군 공격 + 녹색 + 느린 떨림.
//   target=-1 로 호중구가 다른 호중구를 공격 대상으로 인식 (ContactSystem 추가 분기 필요).
export function mutationZombie(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.behavior.target = -1.0;
  m.color.h = 120;
  m.color.s = 40;
  m.shape.w1.omega *= 0.6;
  m.shape.w2.omega *= 0.6;
  return m;
}

// 게임: 변이 2 — 암세포화. 분열 활성 + 비대화 + 어두움.
//   meta.divide 가 활성화되면 NEUTROPHIL 도 분열하는 새 동작 — BehaviorSystem 분기 영향 가능.
export function mutationCancer(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.meta.divide = 0.3;
  m.shape.base *= 1.4;
  m.behavior.contact = 0.1;
  m.color.l = 40;
  m.shape.w1.A *= 1.3;
  return m;
}

// 게임: 변이 3 — 형태 붕괴. 진폭 반전 + 기괴한 주파수 + 빨강 + 빠름.
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

// 게임: 변이 4 — 과민. 떨림 ×3 + 큰 접촉 충격 + 느린 회복 + 주황.
export function mutationHyperactive(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.shape.w1.omega *= 3.0;
  m.shape.w2.omega *= 3.0;
  m.shape.w3.omega *= 3.0;
  m.behavior.contact = 0.7;
  m.meta.recovery = 0.2;
  m.color.h = 45;
  m.color.s = 90;
  return m;
}

// 게임: 변이 5 — 마비. 거의 정지 + 밝은 파랑.
export function mutationParalysis(dna: DNA): DNA {
  const m = cloneDna(dna);
  m.shape.w1.omega = 0.1;
  m.shape.w2.omega = 0.2;
  m.shape.w3.omega = 0.1;
  m.behavior.speed = 0.1;
  m.color.h = 210;
  m.color.l = 80;
  m.shape.w1.A *= 0.3;
  return m;
}

// 게임: 변이 6 — 카오스. 모든 형질 랜덤화.
//   random 함수를 인자로 받음 — 테스트 가능성 (deterministic seed 가능).
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
