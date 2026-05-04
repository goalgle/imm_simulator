import { describe, it, expect } from 'vitest';
import { NutrientSystem } from '../../src/systems/NutrientSystem';

const bounds = { width: 800, height: 600, margin: 20 };
const RESPAWN = 3;

describe('NutrientSystem', () => {
  it('생성 시 지정한 슬롯 수만큼 영양분 보유 (전부 active)', () => {
    const sys = new NutrientSystem(40, bounds, RESPAWN);
    expect(sys.getAllSlots()).toHaveLength(40);
    expect(sys.getActive()).toHaveLength(40);
  });

  it('모든 영양분은 bounds 안쪽에 위치', () => {
    const sys = new NutrientSystem(100, bounds, RESPAWN);
    for (const n of sys.getAllSlots()) {
      expect(n.x).toBeGreaterThanOrEqual(bounds.margin);
      expect(n.x).toBeLessThanOrEqual(bounds.width - bounds.margin);
      expect(n.y).toBeGreaterThanOrEqual(bounds.margin);
      expect(n.y).toBeLessThanOrEqual(bounds.height - bounds.margin);
    }
  });

  it('consume 직후 슬롯은 inactive — active 수 감소, 슬롯 수는 유지', () => {
    const sys = new NutrientSystem(40, bounds, RESPAWN);
    sys.consume(0, 0);
    sys.consume(10, 0);
    sys.consume(39, 0);
    expect(sys.getAllSlots()).toHaveLength(40);
    expect(sys.getActive()).toHaveLength(37);
  });

  it('consume 후 respawnDelay 도달 전엔 inactive 유지', () => {
    const sys = new NutrientSystem(10, bounds, RESPAWN);
    sys.consume(0, 0);
    sys.update(RESPAWN - 0.1);
    expect(sys.get(0)!.active).toBe(false);
  });

  it('respawnDelay 도달 시 새 위치에서 active 부활', () => {
    const sys = new NutrientSystem(10, bounds, RESPAWN);
    const before = { ...sys.get(0)! };
    sys.consume(0, 0);
    sys.update(RESPAWN);
    const after = sys.get(0)!;
    expect(after.active).toBe(true);
    // 두 점이 정확히 일치할 확률 사실상 0
    const moved = before.x !== after.x || before.y !== after.y;
    expect(moved).toBe(true);
  });

  it('findNearestIndex 는 active 슬롯만 후보로 검색', () => {
    const sys = new NutrientSystem(40, bounds, RESPAWN);
    // (0, 0) 에서 가장 가까운 영양분 인덱스
    const idx1 = sys.findNearestIndex(0, 0);
    // 그 영양분을 소비
    sys.consume(idx1, 0);
    // 다시 조회하면 다른 인덱스가 나와야 함
    const idx2 = sys.findNearestIndex(0, 0);
    expect(idx2).not.toBe(idx1);
    // 결과가 active 인지 확인
    expect(sys.get(idx2)!.active).toBe(true);
  });

  it('모든 슬롯이 inactive 면 findNearestIndex 가 -1', () => {
    const sys = new NutrientSystem(3, bounds, RESPAWN);
    sys.consume(0, 0);
    sys.consume(1, 0);
    sys.consume(2, 0);
    expect(sys.findNearestIndex(100, 100)).toBe(-1);
  });

  it('슬롯 0개로 생성하면 항상 -1', () => {
    const sys = new NutrientSystem(0, bounds, RESPAWN);
    expect(sys.findNearestIndex(100, 100)).toBe(-1);
  });
});
