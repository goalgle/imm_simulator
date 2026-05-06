// 항체 (Antibody) 엔티티. B세포가 발사하는 지뢰형 발사체.
// 시스템 구현 기획서 §M7.
//
// 특징:
//   - 발사 직후 vx/vy 로 직선 이동
//   - 누적 이동 거리가 maxRange 도달하면 정지 (vx=vy=0, isStopped=true)
//   - 정지 후에도 그 자리에 남음 (지뢰)
//   - 세균이 영양분처럼 추적 → 흡수 시 isAbsorbed=true + 세균 HP 감소
//
// 클래스가 아닌 단순 데이터 — 행동/렌더는 시스템이 책임.

export type Antibody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  // 게임: 남은 사거리. 매 프레임 |이동거리| 만큼 감소. 0 도달 시 정지.
  remainingRange: number;
  isStopped: boolean;
  isAbsorbed: boolean;
};
