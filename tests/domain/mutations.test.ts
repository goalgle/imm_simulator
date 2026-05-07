import { describe, it, expect } from 'vitest';
import {
  cloneDna,
  mutationZombie,
  mutationCancer,
  mutationCorruption,
  mutationHyperactive,
  mutationParalysis,
  mutationChaos,
  pickMutation,
  applyMutation,
} from '../../src/domain/mutations';
import { NEUTROPHIL } from '../../src/domain/dna';

describe('cloneDna', () => {
  it('새 객체를 반환 (reference 다름)', () => {
    const c = cloneDna(NEUTROPHIL);
    expect(c).not.toBe(NEUTROPHIL);
    expect(c.shape).not.toBe(NEUTROPHIL.shape);
    expect(c.color).not.toBe(NEUTROPHIL.color);
  });

  it('값은 동일 (deep equal)', () => {
    const c = cloneDna(NEUTROPHIL);
    expect(c).toEqual(NEUTROPHIL);
  });

  it('clone 변형이 원본에 영향 없음', () => {
    const c = cloneDna(NEUTROPHIL);
    c.behavior.speed = 999;
    c.color.h = 999;
    expect(NEUTROPHIL.behavior.speed).not.toBe(999);
    expect(NEUTROPHIL.color.h).not.toBe(999);
  });
});

describe('mutationZombie', () => {
  it('target = -1, 녹색 hue, 채도 ↓', () => {
    const m = mutationZombie(NEUTROPHIL);
    expect(m.behavior.target).toBe(-1.0);
    expect(m.color.h).toBe(120);
    expect(m.color.s).toBe(40);
  });

  it('w1/w2 omega 60% 로 감소', () => {
    const m = mutationZombie(NEUTROPHIL);
    expect(m.shape.w1.omega).toBeCloseTo(NEUTROPHIL.shape.w1.omega * 0.6);
    expect(m.shape.w2.omega).toBeCloseTo(NEUTROPHIL.shape.w2.omega * 0.6);
  });

  it('원본 dna 변형 안 됨', () => {
    mutationZombie(NEUTROPHIL);
    expect(NEUTROPHIL.behavior.target).toBe(1.0); // 원본 유지
    expect(NEUTROPHIL.color.h).toBe(322);
  });
});

describe('mutationCancer', () => {
  it('divide 활성, base 1.4배, l 어두움', () => {
    const m = mutationCancer(NEUTROPHIL);
    expect(m.meta.divide).toBe(0.3);
    expect(m.shape.base).toBeCloseTo(NEUTROPHIL.shape.base * 1.4);
    expect(m.color.l).toBe(40);
  });

  it('contact 0.1, w1 진폭 1.3배', () => {
    const m = mutationCancer(NEUTROPHIL);
    expect(m.behavior.contact).toBe(0.1);
    expect(m.shape.w1.A).toBeCloseTo(NEUTROPHIL.shape.w1.A * 1.3);
  });
});

describe('mutationCorruption', () => {
  it('w1.A 부호 반전 (×-0.8), w2.n=13, w3.n=7', () => {
    const m = mutationCorruption(NEUTROPHIL);
    expect(m.shape.w1.A).toBeCloseTo(NEUTROPHIL.shape.w1.A * -0.8);
    expect(m.shape.w2.n).toBe(13);
    expect(m.shape.w3.n).toBe(7);
  });

  it('빨강 + speed 1.3배', () => {
    const m = mutationCorruption(NEUTROPHIL);
    expect(m.color.h).toBe(0);
    expect(m.color.s).toBe(80);
    expect(m.behavior.speed).toBeCloseTo(NEUTROPHIL.behavior.speed * 1.3);
  });
});

describe('mutationHyperactive', () => {
  it('omega ×3, contact 0.7, recovery 0.2, 주황', () => {
    const m = mutationHyperactive(NEUTROPHIL);
    expect(m.shape.w1.omega).toBeCloseTo(NEUTROPHIL.shape.w1.omega * 3);
    expect(m.shape.w2.omega).toBeCloseTo(NEUTROPHIL.shape.w2.omega * 3);
    expect(m.shape.w3.omega).toBeCloseTo(NEUTROPHIL.shape.w3.omega * 3);
    expect(m.behavior.contact).toBe(0.7);
    expect(m.meta.recovery).toBe(0.2);
    expect(m.color.h).toBe(45);
    expect(m.color.s).toBe(90);
  });
});

describe('mutationParalysis', () => {
  it('omega 거의 0, speed 0.1, 밝은 파랑', () => {
    const m = mutationParalysis(NEUTROPHIL);
    expect(m.shape.w1.omega).toBe(0.1);
    expect(m.shape.w2.omega).toBe(0.2);
    expect(m.shape.w3.omega).toBe(0.1);
    expect(m.behavior.speed).toBe(0.1);
    expect(m.color.h).toBe(210);
    expect(m.color.l).toBe(80);
  });

  it('w1.A 0.3배 축소', () => {
    const m = mutationParalysis(NEUTROPHIL);
    expect(m.shape.w1.A).toBeCloseTo(NEUTROPHIL.shape.w1.A * 0.3);
  });
});

describe('mutationChaos', () => {
  // 게임: deterministic random 으로 검증.
  it('주어진 random 값에 따라 모든 형질 랜덤화', () => {
    const seq = [0, 0.5, 0.99, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7];
    let i = 0;
    const random = () => seq[i++ % seq.length];
    const m = mutationChaos(NEUTROPHIL, random);
    // shape.n 은 2 + floor(r * 14) 범위
    expect(m.shape.w1.n).toBeGreaterThanOrEqual(2);
    expect(m.shape.w1.n).toBeLessThanOrEqual(15);
    // omega 0.5~5.0
    expect(m.shape.w1.omega).toBeGreaterThanOrEqual(0.5);
    expect(m.shape.w1.omega).toBeLessThanOrEqual(5.0);
    // target -1~1
    expect(m.behavior.target).toBeGreaterThanOrEqual(-1);
    expect(m.behavior.target).toBeLessThanOrEqual(1);
    // color.h 0~360
    expect(m.color.h).toBeGreaterThanOrEqual(0);
    expect(m.color.h).toBeLessThan(360);
    // color.s 50~100
    expect(m.color.s).toBeGreaterThanOrEqual(50);
    expect(m.color.s).toBeLessThanOrEqual(100);
  });

  it('원본 dna 변형 안 됨', () => {
    mutationChaos(NEUTROPHIL, () => 0.5);
    expect(NEUTROPHIL.color.h).toBe(322);
  });
});

describe('pickMutation — 매핑 boundary', () => {
  it('0 hits → null (정상)', () => {
    expect(pickMutation(0)).toBeNull();
  });

  it('1~2 hits → zombie', () => {
    expect(pickMutation(1)).toBe('zombie');
    expect(pickMutation(2)).toBe('zombie');
  });

  it('3~4 hits → cancer', () => {
    expect(pickMutation(3)).toBe('cancer');
    expect(pickMutation(4)).toBe('cancer');
  });

  it('5~6 hits → corruption', () => {
    expect(pickMutation(5)).toBe('corruption');
    expect(pickMutation(6)).toBe('corruption');
  });

  it('7~8 hits → hyperactive', () => {
    expect(pickMutation(7)).toBe('hyperactive');
    expect(pickMutation(8)).toBe('hyperactive');
  });

  it('9 hits → paralysis', () => {
    expect(pickMutation(9)).toBe('paralysis');
  });

  it('10 hits → chaos', () => {
    expect(pickMutation(10)).toBe('chaos');
  });

  it('음수/초과 입력은 clamp', () => {
    expect(pickMutation(-1)).toBeNull();
    expect(pickMutation(11)).toBe('chaos');
    expect(pickMutation(100)).toBe('chaos');
  });
});

describe('applyMutation — kind 디스패치', () => {
  it('각 kind 가 해당 함수 결과와 동일', () => {
    expect(applyMutation(NEUTROPHIL, 'zombie')).toEqual(mutationZombie(NEUTROPHIL));
    expect(applyMutation(NEUTROPHIL, 'cancer')).toEqual(mutationCancer(NEUTROPHIL));
    expect(applyMutation(NEUTROPHIL, 'corruption')).toEqual(mutationCorruption(NEUTROPHIL));
    expect(applyMutation(NEUTROPHIL, 'hyperactive')).toEqual(mutationHyperactive(NEUTROPHIL));
    expect(applyMutation(NEUTROPHIL, 'paralysis')).toEqual(mutationParalysis(NEUTROPHIL));
  });

  it('chaos 는 전달된 random 함수 사용', () => {
    const random = () => 0.5;
    expect(applyMutation(NEUTROPHIL, 'chaos', random)).toEqual(mutationChaos(NEUTROPHIL, random));
  });
});
