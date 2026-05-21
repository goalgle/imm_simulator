import { describe, expect, it } from 'vitest';
import { EntityRegistry, dnaKindToEntityKind } from '../../src/domain/entityControl';

describe('EntityRegistry', () => {
  it('reset 후 모든 종이 디폴트 (enabled=true, visible=true, frozen=false, speedMul=1, spawnProb=1)', () => {
    const r = new EntityRegistry();
    const kinds = [
      'nutrient', 'bacteria', 'bacteriaCommander',
      'neutrophil', 'neutrophilSuper', 'nk', 'bcell', 'tcell',
      'macrophage', 'antibody', 'bubble',
    ] as const;
    for (const k of kinds) {
      const c = r.get(k);
      expect(c.enabled).toBe(true);
      expect(c.visible).toBe(true);
      expect(c.frozen).toBe(false);
      expect(c.speedMul).toBe(1);
      expect(c.spawnProb).toBe(1);
    }
  });

  it('set 은 명시한 필드만 덮어쓰고 나머지는 유지', () => {
    const r = new EntityRegistry();
    r.set('bacteria', { frozen: true });
    const c = r.get('bacteria');
    expect(c.frozen).toBe(true);
    expect(c.enabled).toBe(true);
    expect(c.visible).toBe(true);
    expect(c.speedMul).toBe(1);
  });

  it('setMany 는 여러 종에 같은 부분 갱신을 일괄 적용', () => {
    const r = new EntityRegistry();
    r.setMany(['neutrophil', 'nk', 'bcell'], { frozen: true, speedMul: 0.5 });
    expect(r.get('neutrophil').frozen).toBe(true);
    expect(r.get('neutrophil').speedMul).toBe(0.5);
    expect(r.get('nk').frozen).toBe(true);
    expect(r.get('bcell').frozen).toBe(true);
    expect(r.get('bacteria').frozen).toBe(false); // 다른 종 영향 X
  });

  it('reset 은 모든 변경을 디폴트로 되돌림', () => {
    const r = new EntityRegistry();
    r.set('bacteria', { enabled: false, frozen: true, speedMul: 0.3 });
    r.set('neutrophil', { visible: false });
    r.reset();
    expect(r.get('bacteria').enabled).toBe(true);
    expect(r.get('bacteria').frozen).toBe(false);
    expect(r.get('bacteria').speedMul).toBe(1);
    expect(r.get('neutrophil').visible).toBe(true);
  });

  it('set 의 부분 갱신은 누적 — 다음 set 이 이전 값을 보존', () => {
    const r = new EntityRegistry();
    r.set('bacteria', { frozen: true });
    r.set('bacteria', { speedMul: 0.5 });
    const c = r.get('bacteria');
    expect(c.frozen).toBe(true);     // 이전 변경 유지
    expect(c.speedMul).toBe(0.5);    // 새 변경 적용
  });

  it('알 수 없는 키 조회는 디폴트 (방어적 fallback)', () => {
    const r = new EntityRegistry();
    // @ts-expect-error — 타입 시스템 우회로 잘못된 키 전달.
    const c = r.get('nonexistent');
    expect(c.enabled).toBe(true);
    expect(c.frozen).toBe(false);
  });
});

describe('dnaKindToEntityKind', () => {
  it('8 DnaKind 가 각각 EntityKind 로 매핑', () => {
    expect(dnaKindToEntityKind('NEUTROPHIL')).toBe('neutrophil');
    expect(dnaKindToEntityKind('NEUTROPHIL_SUPER')).toBe('neutrophilSuper');
    expect(dnaKindToEntityKind('NK_CELL')).toBe('nk');
    expect(dnaKindToEntityKind('BCELL')).toBe('bcell');
    expect(dnaKindToEntityKind('TCELL')).toBe('tcell');
    expect(dnaKindToEntityKind('BACTERIA_A')).toBe('bacteria');
    expect(dnaKindToEntityKind('BACTERIA_COMMANDER')).toBe('bacteriaCommander');
    expect(dnaKindToEntityKind('MACROPHAGE')).toBe('macrophage');
  });
});
