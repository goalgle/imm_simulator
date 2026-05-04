import { describe, it, expect } from 'vitest';
import {
  shockwaveRadius,
  isShockwaveAlive,
  shockwaveImpulse,
  type Shockwave,
} from '../../src/domain/shockwave';

const baseWave = (overrides: Partial<Shockwave> = {}): Shockwave => ({
  x: 100,
  y: 100,
  startTime: 0,
  speed: 200,
  duration: 1.0,
  power: 100,
  bandwidth: 30,
  ...overrides,
});

describe('shockwaveRadius', () => {
  it('발생 직후 반경 0', () => {
    expect(shockwaveRadius(baseWave(), 0)).toBe(0);
  });

  it('시간이 지나면 speed × age 만큼 커짐', () => {
    expect(shockwaveRadius(baseWave({ speed: 200 }), 0.5)).toBe(100);
  });
});

describe('isShockwaveAlive', () => {
  it('duration 이내면 살아있음', () => {
    expect(isShockwaveAlive(baseWave({ duration: 1.0 }), 0.5)).toBe(true);
  });

  it('duration 정확히 도달하면 죽음', () => {
    expect(isShockwaveAlive(baseWave({ duration: 1.0 }), 1.0)).toBe(false);
  });

  it('duration 초과하면 죽음', () => {
    expect(isShockwaveAlive(baseWave({ duration: 1.0 }), 1.5)).toBe(false);
  });
});

describe('shockwaveImpulse', () => {
  it('영향권 밖 세포는 임펄스 0', () => {
    // 반경 100 (t=0.5 × speed 200), bandwidth 30 → 70 ~ 130 거리만 영향권
    const wave = baseWave();
    const t = 0.5;
    const imp = shockwaveImpulse(wave, 100 + 200, 100, t); // dist=200, ring 외부
    expect(imp.dvx).toBe(0);
    expect(imp.dvy).toBe(0);
  });

  it('정확히 링 위 세포는 최대 임펄스 (시간 감쇠 반영)', () => {
    const wave = baseWave({ duration: 1.0 });
    const t = 0.5;
    const radius = shockwaveRadius(wave, t); // 100
    // 세포를 링 위(+x 방향)에 배치
    const imp = shockwaveImpulse(wave, wave.x + radius, wave.y, t);
    // ringFactor=1, timeFactor=0.5 → strength = 100 * 1 * 0.5 = 50
    expect(imp.dvx).toBeCloseTo(50, 5);
    expect(imp.dvy).toBeCloseTo(0, 5);
  });

  it('세포가 발생 지점 정확히 위면 0 (방향 미정)', () => {
    const imp = shockwaveImpulse(baseWave(), 100, 100, 0.1);
    expect(imp.dvx).toBe(0);
    expect(imp.dvy).toBe(0);
  });

  it('임펄스 방향은 발생점에서 세포로 향하는 방사 방향', () => {
    const wave = baseWave();
    const t = 0.5;
    const radius = shockwaveRadius(wave, t);
    // +x 방향 → dvx>0, dvy≈0
    const right = shockwaveImpulse(wave, wave.x + radius, wave.y, t);
    expect(right.dvx).toBeGreaterThan(0);
    expect(right.dvy).toBeCloseTo(0, 5);
    // -y 방향 → dvy<0
    const up = shockwaveImpulse(wave, wave.x, wave.y - radius, t);
    expect(up.dvy).toBeLessThan(0);
    expect(up.dvx).toBeCloseTo(0, 5);
  });

  it('파동이 늙을수록 임펄스가 약해짐 (시간 감쇠)', () => {
    const wave = baseWave({ duration: 1.0 });
    // 같은 상대 위치(링 위)에서 t=0.1 vs t=0.9 비교
    const young = shockwaveImpulse(
      wave,
      wave.x + shockwaveRadius(wave, 0.1),
      wave.y,
      0.1,
    );
    const old = shockwaveImpulse(
      wave,
      wave.x + shockwaveRadius(wave, 0.9),
      wave.y,
      0.9,
    );
    expect(young.dvx).toBeGreaterThan(old.dvx);
  });
});
