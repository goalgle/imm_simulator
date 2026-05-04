// 영양분 풀 관리.
// 시스템 구현 기획서 §2.3 명세:
//   - 화면 내 절대값 고정 슬롯 수
//   - 무작위 위치
//   - 소비 시 즉시 사라지고 일정 시간(respawnDelaySec) 후 다른 무작위 위치에 부활
//
// 이 파일은 Phaser 의존 없음.

import type { Nutrient } from '../entities/Nutrient';

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

  constructor(
    count: number,
    private readonly bounds: NutrientBounds,
    private readonly respawnDelaySec: number,
  ) {
    for (let i = 0; i < count; i++) {
      this.nutrients.push(this.makeFreshNutrient());
    }
  }

  // 게임: 새 영양분(또는 부활용) 생성. 항상 active=true.
  private makeFreshNutrient(): Nutrient {
    const m = this.bounds.margin;
    return {
      x: m + Math.random() * (this.bounds.width - m * 2),
      y: m + Math.random() * (this.bounds.height - m * 2),
      active: true,
      respawnAt: 0,
    };
  }

  // 게임: 인덱스로 영양분 1개 소비. 슬롯은 비활성화되고 respawnDelaySec 후에 부활 예약.
  consume(index: number, t: number): void {
    const n = this.nutrients[index];
    if (!n || !n.active) return;
    n.active = false;
    n.respawnAt = t + this.respawnDelaySec;
  }

  // 게임: 매 프레임 호출. 부활 시각 도달한 비활성 슬롯을 새 위치로 활성화.
  update(t: number): void {
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
}
