// 충돌(접촉) 감지 — 두 엔티티의 baseRadius 합 미만 거리면 접촉 중.
// 시스템 구현 기획서 §1.3: 시각 ≠ 물리. 물리 충돌은 단순 원형 hitbox.
//
// 이 파일은 Phaser 의존 없음 (테스트 가능).

// 게임: 충돌 감지에 필요한 최소 인터페이스.
export type Collidable = {
  readonly x: number;
  readonly y: number;
  readonly dna: { shape: { base: number } };
  // 게임: 죽은 엔티티는 충돌 대상에서 제외 — 시체는 통과 가능.
  isDead(): boolean;
};

// 게임: 두 엔티티가 접촉 중인지. baseRadius 합 미만 거리.
export function isContacting(a: Collidable, b: Collidable): boolean {
  if (a.isDead() || b.isDead()) return false;
  const minDist = a.dna.shape.base + b.dna.shape.base;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy < minDist * minDist;
}
