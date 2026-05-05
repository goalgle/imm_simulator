import { describe, it, expect } from 'vitest';
import {
  evalAvoidPredator,
  evalSeekNutrient,
  evalSeekPrey,
  evalSpaceAlly,
  evalSeekAlly,
  evalFollowCommander,
  computeDesiredDirection,
  type Senses,
} from '../../src/domain/drives';
import { BACTERIA_A, NEUTROPHIL } from '../../src/domain/dna';

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
  });
});

describe('evalSeekPrey', () => {
  it('먹이 없으면 활성도 0', () => {
    const r = evalSeekPrey(0, 0, null);
    expect(r.activation).toBe(0);
  });

  it('먹이 있으면 그 방향으로 활성도 1', () => {
    const r = evalSeekPrey(0, 0, { x: 50, y: 50 });
    expect(r.activation).toBe(1);
    expect(r.dirX).toBeGreaterThan(0);
    expect(r.dirY).toBeGreaterThan(0);
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

describe('evalFollowCommander', () => {
  it('지휘관 없으면 활성도 0', () => {
    const r = evalFollowCommander(0, 0, null);
    expect(r.activation).toBe(0);
  });

  it('controlRadius 이내면 활성도 0 (자유)', () => {
    const r = evalFollowCommander(0, 0, { x: 50, y: 0, controlRadius: 100 });
    expect(r.activation).toBe(0);
  });

  it('controlRadius 밖이면 지휘관 쪽으로 끌림', () => {
    const r = evalFollowCommander(0, 0, { x: 200, y: 0, controlRadius: 100 });
    expect(r.activation).toBeGreaterThan(0);
    expect(r.dirX).toBeCloseTo(1, 5);
    expect(r.dirY).toBeCloseTo(0, 5);
  });

  it('멀어질수록 활성도 ↑, controlRadius × 2 거리에서 1', () => {
    const r1 = evalFollowCommander(0, 0, { x: 150, y: 0, controlRadius: 100 });
    const r2 = evalFollowCommander(0, 0, { x: 250, y: 0, controlRadius: 100 });
    expect(r2.activation).toBeGreaterThan(r1.activation);
    expect(r2.activation).toBeCloseTo(1, 5);
  });

  it('지휘관과 같은 위치면 활성도 0 (방향 미정)', () => {
    const r = evalFollowCommander(50, 50, { x: 50, y: 50, controlRadius: 100 });
    expect(r.activation).toBe(0);
  });
});

describe('computeDesiredDirection — 세균(BACTERIA_A)', () => {
  const self = { x: 100, y: 100 };

  const sensesOf = (over: Partial<Senses> = {}): Senses => ({
    predators: [],
    allies: [self],
    nearestNutrient: null,
    nearestPrey: null,
    nearestCommander: null,
    nearestWorker: null,
    commander: null,
    ...over,
  });

  it('백혈구가 가까이 있으면 회피가 영양분 추구를 압도', () => {
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      sensesOf({
        predators: [{ x: 150, y: 100 }],
        nearestNutrient: { x: 200, y: 100 },
      }),
    );
    expect(dir.dirX).toBeLessThan(0);
  });

  it('백혈구가 멀리 있으면 영양분 방향 우세', () => {
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      sensesOf({
        predators: [{ x: 500, y: 100 }],
        nearestNutrient: { x: 200, y: 100 },
      }),
    );
    expect(dir.dirX).toBeGreaterThan(0);
  });

  it('아무 자극 없으면 영벡터 (정지)', () => {
    const dir = computeDesiredDirection(self, BACTERIA_A.drives, sensesOf());
    expect(dir.dirX).toBe(0);
    expect(dir.dirY).toBe(0);
  });

  it('결과 벡터 크기는 1 또는 0', () => {
    const dir = computeDesiredDirection(
      self,
      BACTERIA_A.drives,
      sensesOf({
        predators: [{ x: 150, y: 100 }],
        nearestNutrient: { x: 200, y: 100 },
      }),
    );
    const m = Math.sqrt(dir.dirX ** 2 + dir.dirY ** 2);
    expect(m).toBeCloseTo(1, 5);
  });
});

describe('computeDesiredDirection — 호중구(NEUTROPHIL)', () => {
  const self = { x: 100, y: 100 };

  it('가장 가까운 세균 방향으로 향함 (seekPrey)', () => {
    const dir = computeDesiredDirection(
      self,
      NEUTROPHIL.drives,
      {
        predators: [],
        allies: [self],
        nearestNutrient: null,
        nearestPrey: { x: 200, y: 100 },
        nearestCommander: null,
        nearestWorker: null,
        commander: null,
      },
    );
    expect(dir.dirX).toBeGreaterThan(0);
    expect(dir.dirY).toBeCloseTo(0, 5);
  });

  it('세균 없으면 정지', () => {
    const dir = computeDesiredDirection(
      self,
      NEUTROPHIL.drives,
      {
        predators: [],
        allies: [self],
        nearestNutrient: null,
        nearestPrey: null,
        nearestCommander: null,
        nearestWorker: null,
        commander: null,
      },
    );
    expect(dir.dirX).toBe(0);
    expect(dir.dirY).toBe(0);
  });
});
