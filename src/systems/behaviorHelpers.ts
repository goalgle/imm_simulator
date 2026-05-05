// BehaviorSystem 공통 헬퍼.
// 살아있는 세포에 drives 평가 결과를 부드러운 가속으로 적용.

import type { LivingCell } from '../entities/LivingCell';
import type { Drives } from '../domain/dna';
import { computeDesiredDirection, type Senses } from '../domain/drives';

// 게임: drives 평가 → desired velocity → turnRate 기반 부드러운 lerp 로 vx/vy 갱신.
//   speed: 이미 hpRatio 등 적용된 최종 속력 (px/s)
//   turnRate: 1/sec — 클수록 desired velocity 로 빠르게 수렴
//   k = 1 - exp(-turnRate × dt) 로 dt 가 작아도 안정적.
export function applyDriveLerp(
  entity: LivingCell,
  drives: Drives,
  senses: Senses,
  speed: number,
  turnRate: number,
  dt: number,
): void {
  const dir = computeDesiredDirection(entity, drives, senses);
  const desiredVx = dir.dirX * speed;
  const desiredVy = dir.dirY * speed;
  const k = 1 - Math.exp(-turnRate * dt);
  entity.vx += (desiredVx - entity.vx) * k;
  entity.vy += (desiredVy - entity.vy) * k;
}
