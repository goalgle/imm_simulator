// 컷신 / 디버그 제어용 — 모든 개체 종류의 등장·표시·정지·속도·확률을 한 곳에서.
//
// 의도: 컷신 대본이 단순한 control('xxx', { frozen: true }) 호출로 시뮬레이션의
//   모든 dimension 을 제어할 수 있도록. 각 시스템은 매 프레임 EntityRegistry 조회
//   → 분기.
//
// Phaser 의존 0 (도메인 계층).

import type { DnaKind } from './dna';

// 게임: 통일된 개체 분류. 시스템·렌더러·컷신 모두 이 키를 공유.
//   세분화 수준: dna.kind 단위 + 객체 단위 (영양분/항체/풍선).
export type EntityKind =
  | 'nutrient'
  | 'bacteria'              // BACTERIA_A
  | 'bacteriaCommander'     // BACTERIA_COMMANDER
  | 'neutrophil'            // NEUTROPHIL
  | 'neutrophilSuper'       // NEUTROPHIL_SUPER
  | 'nk'                    // NK_CELL
  | 'bcell'                 // BCELL
  | 'tcell'                 // TCELL
  | 'macrophage'            // MACROPHAGE
  | 'antibody'              // B세포 발사체
  | 'bubble';               // 페이즈 2 풍선

// 게임: 개체 종류별 4+1 dimension 의 제어 상태.
//   enabled   : 새 spawn 허용 여부. false 면 모든 spawn 시도 무시 (기존 인스턴스는 영향 X).
//   visible   : 화면 표시 여부. false 면 handle.setVisible(false) — 행동은 별개.
//   frozen    : 행동 정지. behavior 시스템이 분기로 무시. 충돌·시각도 정지.
//   speedMul  : 속도 배수 (이동·발사 속도 등). 1=정상. 0=정지와 동일 효과 (단 frozen 과는 의미 다름).
//                정지 객체 (영양분 등) 엔 무영향.
//   spawnProb : 등장 확률 (0~1). 확률 분기 있는 종류만 의미.
//                예: 대식세포의 호중구 생산 → NK 1/10 분기는 spawnProb('nk') 로 표현.
//                일반적 spawn 엔 무영향 (=enabled 만 본다).
export type EntityControl = {
  enabled: boolean;
  visible: boolean;
  frozen: boolean;
  speedMul: number;
  spawnProb: number;
};

// 게임: 디폴트 — 정상 게임 상태. 모든 종 활성, 보임, 안 정지, 속도 1×, 확률 1.
//   spawnProb=1 은 "기본 분기 그대로" 의미. 시스템이 자기 디폴트 확률 (예: NK 1/10) 곱셈.
const DEFAULT: EntityControl = {
  enabled: true,
  visible: true,
  frozen: false,
  speedMul: 1,
  spawnProb: 1,
};

// 게임: 모든 개체 종류의 control 보유 중앙 객체.
//   - 컷신·디버그가 set / setMany 로 변경
//   - 시스템·렌더러가 get 으로 조회
//   - reset 으로 모든 종 디폴트 복귀 (스테이지 재시작, 컷신 종료 시)
export class EntityRegistry {
  private readonly controls: Map<EntityKind, EntityControl> = new Map();

  constructor() {
    this.reset();
  }

  // 게임: 모든 종 디폴트로. 스테이지 시작 / 씬 재시작 / 컷신 종료 시 호출.
  reset(): void {
    const kinds: EntityKind[] = [
      'nutrient', 'bacteria', 'bacteriaCommander',
      'neutrophil', 'neutrophilSuper', 'nk', 'bcell', 'tcell',
      'macrophage', 'antibody', 'bubble',
    ];
    for (const k of kinds) this.controls.set(k, { ...DEFAULT });
  }

  // 게임: 특정 종의 부분 갱신. 명시한 필드만 덮어씀. 나머지는 유지.
  set(kind: EntityKind, partial: Partial<EntityControl>): void {
    const cur = this.controls.get(kind);
    if (!cur) return;
    this.controls.set(kind, { ...cur, ...partial });
  }

  // 게임: 여러 종에 동일 부분 갱신 일괄. 예: 모든 백혈구 freeze.
  setMany(kinds: readonly EntityKind[], partial: Partial<EntityControl>): void {
    for (const k of kinds) this.set(k, partial);
  }

  // 게임: 조회. 없는 키는 디폴트 반환 (방어적 — 정상 흐름에선 발생 X).
  get(kind: EntityKind): EntityControl {
    return this.controls.get(kind) ?? { ...DEFAULT };
  }
}

// 게임: DNA preset 의 kind 라벨 → EntityRegistry 키 매핑.
//   백혈구 종족별 cell.dnaKind 로 registry 조회할 때 사용.
//   세균은 BACTERIA_A vs BACTERIA_COMMANDER 분리 (커맨더는 별도 제어 가능).
export function dnaKindToEntityKind(kind: DnaKind): EntityKind {
  switch (kind) {
    case 'NEUTROPHIL':         return 'neutrophil';
    case 'NEUTROPHIL_SUPER':   return 'neutrophilSuper';
    case 'NK_CELL':            return 'nk';
    case 'BCELL':              return 'bcell';
    case 'TCELL':              return 'tcell';
    case 'BACTERIA_A':         return 'bacteria';
    case 'BACTERIA_COMMANDER': return 'bacteriaCommander';
    case 'MACROPHAGE':         return 'macrophage';
  }
}
