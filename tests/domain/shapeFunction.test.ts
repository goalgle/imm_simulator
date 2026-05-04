import { describe, it, expect } from 'vitest';
import { evaluateRadius, generatePolygon } from '../../src/domain/shapeFunction';
import { NEUTROPHIL } from '../../src/domain/dna';

describe('evaluateRadius', () => {
  it('θ=0, t=0, phase=0 에서 모든 sin 항이 0 → r 은 정확히 base', () => {
    const r = evaluateRadius(NEUTROPHIL, 0, 0, 0);
    expect(r).toBe(NEUTROPHIL.shape.base);
  });

  it('θ 가 변하면 결과도 변한다', () => {
    const r0 = evaluateRadius(NEUTROPHIL, 0, 1);
    const r1 = evaluateRadius(NEUTROPHIL, Math.PI / 4, 1);
    expect(r0).not.toBe(r1);
  });

  it('phase shift 가 결과에 반영된다', () => {
    const r0 = evaluateRadius(NEUTROPHIL, 0.5, 1, 0);
    const r1 = evaluateRadius(NEUTROPHIL, 0.5, 1, Math.PI);
    expect(r0).not.toBe(r1);
  });

  it('r 은 base 의 합리적 범위 안에 있다 (진폭 합 < 1)', () => {
    const base = NEUTROPHIL.shape.base;
    const maxAmp = NEUTROPHIL.shape.w1.A + NEUTROPHIL.shape.w2.A + NEUTROPHIL.shape.w3.A;
    for (let i = 0; i < 100; i++) {
      const theta = (i / 100) * Math.PI * 2;
      const r = evaluateRadius(NEUTROPHIL, theta, i * 0.1);
      expect(r).toBeGreaterThan(base * (1 - maxAmp));
      expect(r).toBeLessThan(base * (1 + maxAmp));
    }
  });
});

describe('generatePolygon', () => {
  it('지정한 vertex 수만큼 점을 반환', () => {
    const pts = generatePolygon(NEUTROPHIL, 0, 32);
    expect(pts).toHaveLength(32);
  });

  it('out 버퍼를 넘기면 같은 배열에 갱신 (재할당 없음)', () => {
    const buf = Array.from({ length: 32 }, () => ({ x: 0, y: 0 }));
    const result = generatePolygon(NEUTROPHIL, 0, 32, 0, buf);
    expect(result).toBe(buf);
    expect(result[0]).toBe(buf[0]);
  });

  it('각 점은 원점 기준 반지름 r 위에 위치 (sqrt(x²+y²) ≈ r)', () => {
    const pts = generatePolygon(NEUTROPHIL, 0, 32);
    for (let i = 0; i < pts.length; i++) {
      const theta = (i / pts.length) * Math.PI * 2;
      const expected = evaluateRadius(NEUTROPHIL, theta, 0);
      const actual = Math.sqrt(pts[i].x ** 2 + pts[i].y ** 2);
      expect(actual).toBeCloseTo(expected, 5);
    }
  });
});
