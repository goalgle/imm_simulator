import { describe, it, expect } from 'vitest';
import { isContacting, type Collidable } from '../../src/domain/contact';

const make = (x: number, y: number, base: number, dead = false): Collidable => ({
  x,
  y,
  dna: { shape: { base } },
  isDead: () => dead,
});

describe('isContacting', () => {
  it('두 엔티티 거리가 baseRadius 합 미만이면 접촉', () => {
    const a = make(0, 0, 10);
    const b = make(15, 0, 10); // 거리 15 < 20 (10+10)
    expect(isContacting(a, b)).toBe(true);
  });

  it('두 엔티티 거리가 baseRadius 합 이상이면 접촉 X', () => {
    const a = make(0, 0, 10);
    const b = make(25, 0, 10); // 거리 25 > 20
    expect(isContacting(a, b)).toBe(false);
  });

  it('정확히 합 거리면 접촉 X (경계 미만)', () => {
    const a = make(0, 0, 10);
    const b = make(20, 0, 10); // 정확히 20 = 20
    expect(isContacting(a, b)).toBe(false);
  });

  it('한쪽이 죽었으면 접촉 X (시체는 통과)', () => {
    const a = make(0, 0, 10, true);
    const b = make(15, 0, 10);
    expect(isContacting(a, b)).toBe(false);
  });

  it('둘 다 죽었으면 접촉 X', () => {
    const a = make(0, 0, 10, true);
    const b = make(15, 0, 10, true);
    expect(isContacting(a, b)).toBe(false);
  });

  it('대각선도 정확하게 거리 계산', () => {
    const a = make(0, 0, 10);
    const b = make(12, 12, 10); // 거리 sqrt(288)≈17 < 20
    expect(isContacting(a, b)).toBe(true);
  });
});
