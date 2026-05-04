// 영양분(Nutrient) 엔티티.
// 시스템 구현 기획서 §2.3 — 생명체 아닌 단순 분류.
// DNA 없음, 자체 행동 없음, 충격파 영향 없음.
//
// 클래스가 아닌 단순 데이터 타입 — 행동/렌더는 시스템이 책임.
//
// active=false 인 영양분은 "리젠 대기" 상태:
//   - 화면에 그려지지 않음
//   - findNearestIndex 검색 대상에서 제외
//   - respawnAt 도달 시 새 무작위 위치에 active=true 로 부활

export type Nutrient = {
  x: number;
  y: number;
  active: boolean;
  respawnAt: number;
};
