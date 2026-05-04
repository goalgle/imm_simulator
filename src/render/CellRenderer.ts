// 세포 렌더링 어댑터 인터페이스.
// 시스템 구현 기획서 §1.2 — 본 게임 로직은 이 인터페이스에만 의존.
// 구현체를 GraphicsCellRenderer (현재) → SDFCellRenderer (필요 시) 로 교체하더라도
// 엔티티/씬 코드는 무수정.
//
// 이 파일은 Phaser 의존 없음 (인터페이스만 정의).

import type { DNA } from '../domain/dna';

// 게임: 한 세포의 렌더 핸들. 위치/위상/스케일/시간 갱신과 파괴를 책임.
//        DNA 자체는 핸들 생성 시 결정되며 이후 불변 (변이는 새 핸들 생성으로 처리).
export interface CellRenderHandle {
  setPosition(x: number, y: number): void;
  setPhase(phase: number): void;
  // 게임: 시각 스케일 배율 (1.0 = 원본). 분열 애니메이션, 약화, 흡수 직후 팽창 등에 사용.
  //        DNA 변경 없이 표시 크기만 일시 변경.
  setScale(scale: number): void;
  // 게임: 매 프레임 호출. t 는 게임 시작 후 경과 시간(초).
  update(t: number): void;
  destroy(): void;
}

// 게임: 렌더러 팩토리. 씬 단위로 인스턴스화하여 핸들을 발급.
export interface CellRenderer {
  create(dna: DNA, x: number, y: number): CellRenderHandle;
}
