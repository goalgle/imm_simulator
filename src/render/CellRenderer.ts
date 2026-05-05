// 세포 렌더링 어댑터 인터페이스.
// 시스템 구현 기획서 §1.2 — 본 게임 로직은 이 인터페이스에만 의존.
// 구현체를 GraphicsCellRenderer (현재) → SDFCellRenderer (필요 시) 로 교체하더라도
// 엔티티/씬 코드는 무수정.
//
// 이 파일은 Phaser 의존 없음 (인터페이스만 정의).

import type { DNA } from '../domain/dna';

// 게임: 시각 자극 채널. 엔티티가 매 프레임 통보. 렌더러가 합성하여 색/형태에 반영.
//   shock  : 충격파 임펄스 — 자기 색이 진해짐 (채도 ↑, 명도 ↓)
//   combat : 적과 접촉 — 색조가 빨강 쪽으로 lerp (다른 색이 됨)
//   life   : 0~1 (1=정상, 0=사망). 0 이면 채도 0 (회색) + 형태 떨림 정지.
export type VisualState = {
  shock: number;
  combat: number;
  life: number;
};

// 게임: 한 세포의 렌더 핸들. 위치/위상/스케일/시각상태/시간 갱신과 파괴를 책임.
//        DNA 자체는 핸들 생성 시 결정되며 이후 불변 (변이는 새 핸들 생성으로 처리).
export interface CellRenderHandle {
  setPosition(x: number, y: number): void;
  setPhase(phase: number): void;
  // 게임: 시각 스케일 배율 (1.0 = 원본). 분열, 약화 등에 사용.
  setScale(scale: number): void;
  // 게임: 시각 상태 통보. shock/combat/life 채널을 한꺼번에.
  setVisualState(state: VisualState): void;
  // 게임: 매 프레임 호출. t 는 게임 시작 후 경과 시간(초).
  update(t: number): void;
  destroy(): void;
}

// 게임: 렌더러 팩토리. 씬 단위로 인스턴스화하여 핸들을 발급.
export interface CellRenderer {
  create(dna: DNA, x: number, y: number): CellRenderHandle;
}
