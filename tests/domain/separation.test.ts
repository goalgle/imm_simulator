import { describe, it, expect } from 'vitest';
import { applySeparation, type SeparableEntity } from '../../src/domain/separation';

// 게임: 테스트용 엔티티 생성기.
const make = (x: number, y: number, base: number): SeparableEntity => ({
  x,
  y,
  vx: 0,
  vy: 0,
  dna: { shape: { base } },
});

describe('applySeparation', () => {
  it('충분히 떨어져 있으면 vx/vy 변화 없음', () => {
    const a = make(0, 0, 10);
    const b = make(100, 0, 10);
    applySeparation([a, b], 5, 200, 0.016);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it('너무 가까우면 서로 멀어지는 방향으로 가속', () => {
    const a = make(0, 0, 10);
    const b = make(15, 0, 10);
    // minDist = 10 + 10 + 5 = 25, 실제 거리 15 → 겹침
    applySeparation([a, b], 5, 200, 0.016);
    expect(a.vx).toBeLessThan(0); // a 는 -x 로
    expect(b.vx).toBeGreaterThan(0); // b 는 +x 로
    expect(a.vx).toBeCloseTo(-b.vx, 5); // 대칭
  });

  it('많이 겹칠수록 더 큰 가속', () => {
    const a1 = make(0, 0, 10);
    const b1 = make(22, 0, 10); // 살짝 겹침
    applySeparation([a1, b1], 5, 200, 0.016);

    const a2 = make(0, 0, 10);
    const b2 = make(12, 0, 10); // 많이 겹침
    applySeparation([a2, b2], 5, 200, 0.016);

    expect(Math.abs(b2.vx)).toBeGreaterThan(Math.abs(b1.vx));
  });

  it('정확히 같은 위치에 있어도 분리 발생 (영벡터 회피)', () => {
    const a = make(50, 50, 10);
    const b = make(50, 50, 10);
    applySeparation([a, b], 5, 200, 0.016);
    // 정확한 방향은 무작위지만 두 객체의 속도가 정반대여야 함
    expect(a.vx).toBeCloseTo(-b.vx, 5);
    expect(a.vy).toBeCloseTo(-b.vy, 5);
    // 영벡터는 아님
    const magA = Math.sqrt(a.vx ** 2 + a.vy ** 2);
    expect(magA).toBeGreaterThan(0);
  });

  it('3개 이상 모두 겹쳐도 모든 쌍에 분리 적용', () => {
    const a = make(0, 0, 10);
    const b = make(15, 0, 10);
    const c = make(0, 15, 10);
    applySeparation([a, b, c], 5, 200, 0.016);
    // a 는 b, c 모두로부터 밀려나야 함 → -x, -y 둘 다
    expect(a.vx).toBeLessThan(0);
    expect(a.vy).toBeLessThan(0);
  });
});
