// 영양분 풀 관리.
// 시스템 구현 기획서 §2.3 명세:
//   - 화면 내 절대값 고정 슬롯 수
//   - 무작위 위치
//   - 소비 시 즉시 사라지고 일정 시간(respawnDelaySec) 후 다른 무작위 위치에 부활
//
// 이 파일은 Phaser 의존 없음.

import type { Nutrient } from '../entities/Nutrient';
import type { EntityRegistry } from '../domain/entityControl';

// 게임: 영양분 배치 영역. 화면 경계 안쪽 margin 만큼 들여서 가장자리 끼임 방지.
export type NutrientBounds = {
  width: number;
  height: number;
  margin: number;
};

export class NutrientSystem {
  // 게임: 슬롯 수는 고정. 각 슬롯의 active/inactive 가 실제 영양분 존재 여부를 표현.
  //        consume → active=false + respawnAt=t+delay
  //        update(t)에서 respawnAt 도달한 슬롯들을 새 위치로 부활.
  private nutrients: Nutrient[] = [];
  // 게임: 컷신 (Session 21) — frozen=true 면 update() 부활 검사 skip + consume 도 respawnAt 무한대.
  //   컷신 도중 세균이 영양분 흡수 시 자동 부활 차단 — 지정된 5개만 등장.
  frozen = false;
  // 게임: 부활 지연 배수 (디폴트 1). consume 시 effectiveDelay = respawnDelaySec × respawnDelayMul.
  //   2.0 = 부활이 2배 느림 (리젠 ½). 0.5 = 2배 빠름. 동적 조절 가능 — BloodScene 의 매 프레임 검사.
  respawnDelayMul = 1;
  // 게임: 영양분 부활 위치 override (Session 21). null 이면 화면 전체 무작위, 설정 시 박스 안 무작위.
  //   컷신 reinforcement 단계에서 백혈구 centroid 근처로 제한 — 세균이 백혈구 영역에 들어와야 먹음.
  private spawnBox: { cx: number; cy: number; half: number } | null = null;

  constructor(
    count: number,
    private readonly bounds: NutrientBounds,
    private readonly respawnDelaySec: number,
    private readonly registry: EntityRegistry,
  ) {
    for (let i = 0; i < count; i++) {
      this.nutrients.push(this.makeFreshNutrient());
    }
  }

  // 게임: 부활 영역 override 설정/해제 (Session 21 컷신용).
  setSpawnBox(box: { cx: number; cy: number; half: number } | null): void {
    this.spawnBox = box;
  }

  // 게임: 새 영양분(또는 부활용) 생성. 항상 active=true. spawnBox 설정 시 그 안에서 무작위, 아니면 화면 전체.
  //   spawnBox 분기에 화면 margin clamp 추가 — 박스가 화면 끝에 걸쳐 있으면 영양분이 화면 밖
  //   생성되는 문제 방지 (백혈구 centroid 가 끝에 몰릴 때 등).
  private makeFreshNutrient(): Nutrient {
    const m = this.bounds.margin;
    if (this.spawnBox !== null) {
      const b = this.spawnBox;
      const rawX = b.cx + (Math.random() * 2 - 1) * b.half;
      const rawY = b.cy + (Math.random() * 2 - 1) * b.half;
      return {
        x: Math.max(m, Math.min(this.bounds.width - m, rawX)),
        y: Math.max(m, Math.min(this.bounds.height - m, rawY)),
        active: true,
        respawnAt: 0,
      };
    }
    return {
      x: m + Math.random() * (this.bounds.width - m * 2),
      y: m + Math.random() * (this.bounds.height - m * 2),
      active: true,
      respawnAt: 0,
    };
  }

  // 게임: 인덱스로 영양분 1개 소비. 슬롯은 비활성화되고 respawnDelaySec × respawnDelayMul 후에 부활 예약.
  //   frozen 중에는 respawnAt 을 무한대로 — 컷신 동안 부활 차단.
  //   respawnDelayMul 이 동적으로 변경되어도 다음 consume 부터 반영 (이미 예약된 슬롯은 그대로).
  consume(index: number, t: number): void {
    const n = this.nutrients[index];
    if (!n || !n.active) return;
    n.active = false;
    n.respawnAt = this.frozen ? Number.MAX_SAFE_INTEGER : t + this.respawnDelaySec * this.respawnDelayMul;
  }

  // 게임: 매 프레임 호출. 부활 시각 도달한 비활성 슬롯을 새 위치로 활성화.
  //   frozen / registry.nutrient.frozen / !enabled 중 하나라도 면 부활 검사 skip.
  update(t: number): void {
    if (this.frozen) return;
    const ctrl = this.registry.get('nutrient');
    if (ctrl.frozen || !ctrl.enabled) return;
    for (const n of this.nutrients) {
      if (!n.active && t >= n.respawnAt) {
        const fresh = this.makeFreshNutrient();
        n.x = fresh.x;
        n.y = fresh.y;
        n.active = true;
        n.respawnAt = 0;
      }
    }
  }

  // 게임: 위치 (x, y) 에서 가장 가까운 active 영양분의 인덱스를 반환. 없으면 -1.
  findNearestIndex(x: number, y: number): number {
    let bestIdx = -1;
    let bestDist2 = Infinity;
    for (let i = 0; i < this.nutrients.length; i++) {
      const n = this.nutrients[i];
      if (!n.active) continue;
      const dx = n.x - x;
      const dy = n.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // 게임: 그리기/디버그용. active 만 반환.
  getActive(): Nutrient[] {
    return this.nutrients.filter((n) => n.active);
  }

  // 게임: 모든 슬롯 (active + inactive 모두). 테스트/디버그용.
  getAllSlots(): readonly Nutrient[] {
    return this.nutrients;
  }

  get(index: number): Nutrient | undefined {
    return this.nutrients[index];
  }

  // 게임: 컷신 (Session 21) — 모든 슬롯 비활성 + 부활 무한 지연 (외부에서 명시적으로 enableAll 호출 전까지).
  //   컷신 시작 시 호출. 게임 본 영양분이 컷신 화면에 보이지 않도록.
  disableAll(): void {
    for (const n of this.nutrients) {
      n.active = false;
      n.respawnAt = Number.MAX_SAFE_INTEGER;
    }
  }

  // 게임: 컷신 (Session 21) — 모든 슬롯 즉시 활성화 + 새 무작위 위치. 컷신 종료 후 정상 진행 진입 시 호출.
  enableAll(): void {
    for (const n of this.nutrients) {
      const fresh = this.makeFreshNutrient();
      n.x = fresh.x;
      n.y = fresh.y;
      n.active = true;
      n.respawnAt = 0;
    }
  }

  // 게임: 컷신 (Session 21) — 특정 슬롯을 지정 위치에 활성화. 컷신 spawnNutrients 액션 사용.
  //   슬롯 부족 시 false. registry.nutrient.enabled === false 면 false (등장 차단).
  //   화면 margin 안쪽으로 clamp — applyNutrientRegen 의 spawnBox 가 화면 끝에 걸쳐 음수 좌표가
  //   전달돼도 보이는 영역으로 강제. 세균이 끝에 안 모이게 보호.
  spawnAt(index: number, x: number, y: number): boolean {
    if (!this.registry.get('nutrient').enabled) return false;
    const n = this.nutrients[index];
    if (!n) return false;
    const m = this.bounds.margin;
    n.x = Math.max(m, Math.min(this.bounds.width - m, x));
    n.y = Math.max(m, Math.min(this.bounds.height - m, y));
    n.active = true;
    n.respawnAt = 0;
    return true;
  }

  // 게임: 컷신 (Session 21) — 활성 영양분 수. 'spawnBacteria' ACTION 종료 조건 (모두 흡수) 검사용.
  getActiveCount(): number {
    let c = 0;
    for (const n of this.nutrients) if (n.active) c++;
    return c;
  }
}
