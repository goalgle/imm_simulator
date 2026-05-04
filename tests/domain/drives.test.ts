import { describe, it, expect } from 'vitest';
import {
  evalAvoidPredator,
  evalSeekNutrient,
  evalSpaceAlly,
  evalSeekAlly,
  computeDesiredDirection,
} from '../../src/domain/drives';
import { BACTERIA_A } from '../../src/domain/dna';

describe('evalAvoidPredator', () => {
  it('포식자 없으면 활성도 0', () => {
    const r = evalAvoidPredator(100, 100, [], 200);
    expect(r.activation).toBe(0);
  });

  it('triggerRadius 밖이면 활성도 0', () => {
    const r = evalAvoidPredator(0, 0, [{ x: 300, y: 0 }], 200);
    expect(r.activation).toBe(0);
  });

  it('triggerRadius 안이면 활성도 > 0, 방향은 포식자에서 멀어짐', () => {
    // 포식자 (100, 0), 자기 (0, 0), 멀어지는 방향 = -x
    const r = evalAvoidPredator(0, 0, [{ x: 100, y: 0 }], 200);
    expect(r.activation).toBeGreaterThan(0);
    expect(r.dirX).toBeLessThan(0);
    expect(r.dirY).toBeCloseTo(0, 5);
  });

  it('포식자가 가까울수록 활성도 높음', () => {
    const close = evalAvoidPredator(0, 0, [{ x: 50, y: 0 }], 200);
    const far = evalAvoidPredator(0, 0, [{ x: 150, y: 0 }], 200);
    expect(close.activation).toBeGreaterThan(far.activation);
  });
});

describe('evalSeekNutrient', () => {
  it('영양분 없으면 활성도 0', () => {
    const r = evalSeekNutrient(0, 0, null);
    expect(r.activation).toBe(0);
  });

  it('영양분 있으면 활성도 1, 방향은 영양분 쪽', () => {
    const r = evalSeekNutrient(0, 0, { x: 100, y: 0 });
    expect(r.activation).toBe(1);
    expect(r.dirX).toBeCloseTo(1, 5);
    expect(r.dirY).toBeCloseTo(0, 5);
  });
});

describe('evalSpaceAlly', () => {
  it('동족 없으면 활성도 0', () => {
    const self = { x: 0, y: 0 };
    const r = evalSpaceAlly(0, 0, [], self, 50);
    expect(r.activation).toBe(0);
  });

  it('자기 자신은 동족 후보에서 제외', () => {
    const self = { x: 0, y: 0 };
    const r = evalSpaceAlly(0, 0, [self], self, 50);
    expect(r.activation).toBe(0);
  });

  it('comfortRadius 안의 동족이 있으면 멀어지는 방향', () => {
    const self = { x: 0, y: 0 };
    const ally = { x: 30, y: 0 };
    const r = evalSpaceAlly(0, 0, [self, ally], self, 50);
    expect(r.activation).toBeGreaterThan(0);
    expect(r.dirX).toBeLessThan(0);
  });

  it('comfortRadius 밖의 동족은 무시', () => {
    const self = { x: 0, y: 0 };
    const ally = { x: 100, y: 0 };
    const r = evalSpaceAlly(0, 0, [self, ally], self, 50);
    expect(r.activation).toBe(0);
  });
});

describe('evalSeekAlly', () => {
  it('자기 자신만 있으면 활성도 0', () => {
    const self = { x: 0, y: 0 };
    const r = evalSeekAlly(0, 0, [self], self);
    expect(r.activation).toBe(0);
  });

  it('동족이 있으면 그 방향으로', () => {
    const self = { x: 0, y: 0 };
    const ally = { x: 100, y: 0 };
    const r = evalSeekAlly(0, 0, [self, ally], self);
    expect(r.activation).toBe(1);
    expect(r.dirX).toBeCloseTo(1, 5);
  });
});

describe('computeDesiredDirection (BACTERIA_A 기준)', () => {
  const self = { x: 100, y: 100 };

  it('백혈구가 가까이 있으면 회피가 영양분 추구를 압도', () => {
    // 자기(100,100), 영양분(200, 100) → +x 방향
    // 백혈구(150, 100) → 회피 = -x 방향, triggerRadius 180 안 → 활성 강함
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      [{ x: 150, y: 100 }],
      [self],
      { x: 200, y: 100 },
    );
    expect(dir.dirX).toBeLessThan(0); // 백혈구로부터 멀어짐 (= -x)
  });

  it('백혈구가 멀리 있으면 영양분 방향 우세', () => {
    // 백혈구는 triggerRadius 밖(>180px)
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      [{ x: 500, y: 100 }],
      [self],
      { x: 200, y: 100 },
    );
    expect(dir.dirX).toBeGreaterThan(0);
  });

  it('아무 자극 없으면 영벡터 (정지)', () => {
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      [],
      [self],
      null,
    );
    expect(dir.dirX).toBe(0);
    expect(dir.dirY).toBe(0);
  });

  it('결과 벡터 크기는 1 또는 0', () => {
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      [{ x: 150, y: 100 }],
      [self],
      { x: 200, y: 100 },
    );
    const m = Math.sqrt(dir.dirX ** 2 + dir.dirY ** 2);
    expect(m).toBeCloseTo(1, 5);
  });
});
