import { describe, it, expect, beforeEach } from 'vitest';
import { getPerkState, resetPerkState, applyPerk, pickRandomPerks, PERK_DEFS } from '../../src/domain/perks';

describe('PerkState', () => {
  beforeEach(() => resetPerkState());

  it('reset 후 모두 디폴트 (배수 1, 가산 0)', () => {
    const s = getPerkState();
    expect(s.speedMul).toBe(1);
    expect(s.hpMul).toBe(1);
    expect(s.nutrientRegenMul).toBe(1);
    expect(s.superBonus).toBe(0);
    expect(s.nkBonus).toBe(0);
    expect(s.tcellCount).toBe(0);
    expect(s.bcellCount).toBe(0);
  });

  it('applyPerk 배수형 — 누적 곱', () => {
    applyPerk('speed');
    expect(getPerkState().speedMul).toBeCloseTo(1.2);
    applyPerk('speed');
    expect(getPerkState().speedMul).toBeCloseTo(1.44);
  });

  it('applyPerk 가산형 — 누적 합', () => {
    applyPerk('tcell');
    applyPerk('tcell');
    expect(getPerkState().tcellCount).toBe(2);
    applyPerk('nkChance');
    expect(getPerkState().nkBonus).toBeCloseTo(0.1);
  });

  it('hp / nutrientRegen 배수 누적', () => {
    applyPerk('hp');
    expect(getPerkState().hpMul).toBeCloseTo(1.25);
    applyPerk('nutrientRegen');
    expect(getPerkState().nutrientRegenMul).toBeCloseTo(1.4);
  });

  it('resetPerkState 가 누적을 초기화', () => {
    applyPerk('speed');
    applyPerk('hp');
    resetPerkState();
    expect(getPerkState().speedMul).toBe(1);
    expect(getPerkState().hpMul).toBe(1);
  });
});

describe('pickRandomPerks', () => {
  it('기본 3개 반환, 중복 없음', () => {
    const picks = pickRandomPerks(3, () => 0.5);
    expect(picks).toHaveLength(3);
    const ids = picks.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('count 가 전체보다 크면 전체 반환', () => {
    const picks = pickRandomPerks(99);
    expect(picks).toHaveLength(PERK_DEFS.length);
  });

  it('반환 항목은 PERK_DEFS 의 멤버', () => {
    const picks = pickRandomPerks(3);
    for (const p of picks) {
      expect(PERK_DEFS.some((d) => d.id === p.id)).toBe(true);
    }
  });
});
