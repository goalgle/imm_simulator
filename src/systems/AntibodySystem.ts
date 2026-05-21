// 항체 풀 관리 시스템 (M7).
// 매 프레임:
//   1) 활성(미정지) 항체 위치 적분 + 사거리 차감
//   2) 사거리 만료 시 정지 처리 (제거 X — 지뢰로 남음)
//   3) 정지 항체 maxStopped 초과 시 가장 오래된 것부터 정리 (FIFO)
//   4) isAbsorbed=true 인 항체 풀에서 제거
//
// 세균 흡수는 BacteriaBehaviorSystem 이 처리 (영양분/항체 분기).

import type { Antibody } from '../entities/Antibody';
import type { EntityRegistry } from '../domain/entityControl';

export class AntibodySystem {
  private antibodies: Antibody[] = [];

  // 게임: 정지 항체 최대 개수. 초과 시 가장 오래된 것부터 자동 정리.
  //        무한 누적 방지. 옵션으로 남김 (BloodScene 에서 ANTIBODY_MAX_STOPPED 상수로 주입).
  constructor(
    private readonly maxStopped: number = 5,
    private readonly registry?: EntityRegistry,
  ) {}

  // 게임: B세포가 발사 시 호출.
  //   registry.antibody.enabled === false 면 spawn 무시 (B세포는 cooldown 만 진행).
  //   speedMul 은 발사 시점 속도에 곱 — 발사 후 등속 운동이라 매 프레임 적용 X.
  spawn(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    armament: { projectileSpeed: number; projectileDamage: number; projectileRange: number },
  ): void {
    if (this.registry && !this.registry.get('antibody').enabled) return;
    const speedMul = this.registry?.get('antibody').speedMul ?? 1;
    const speed = armament.projectileSpeed * speedMul;
    this.antibodies.push({
      x,
      y,
      vx: dirX * speed,
      vy: dirY * speed,
      damage: armament.projectileDamage,
      remainingRange: armament.projectileRange,
      isStopped: false,
      isAbsorbed: false,
    });
  }

  update(dt: number): void {
    // 게임: registry.antibody.frozen === true 면 이동 정지 + 청소만.
    const frozen = this.registry?.get('antibody').frozen ?? false;
    // 1) 위치 적분 + 사거리 만료 시 정지.
    for (const ab of this.antibodies) {
      if (ab.isAbsorbed) continue;
      if (frozen) continue;
      if (!ab.isStopped) {
        const dx = ab.vx * dt;
        const dy = ab.vy * dt;
        ab.x += dx;
        ab.y += dy;
        const traveled = Math.sqrt(dx * dx + dy * dy);
        ab.remainingRange -= traveled;
        if (ab.remainingRange <= 0) {
          ab.vx = 0;
          ab.vy = 0;
          ab.isStopped = true;
        }
      }
    }

    // 2) 정지 항체 N 개 초과 시 가장 오래된 (배열 인덱스 작은) 것부터 isAbsorbed=true.
    //    배열 push 순서가 발사 순서이고, 같은 B세포가 같은 사거리로 쏘면 정지 순서도 동일.
    let stoppedCount = 0;
    for (const ab of this.antibodies) {
      if (ab.isStopped && !ab.isAbsorbed) stoppedCount++;
    }
    if (stoppedCount > this.maxStopped) {
      let toRemove = stoppedCount - this.maxStopped;
      for (const ab of this.antibodies) {
        if (toRemove <= 0) break;
        if (ab.isStopped && !ab.isAbsorbed) {
          ab.isAbsorbed = true;
          toRemove--;
        }
      }
    }

    // 3) isAbsorbed 청소.
    this.antibodies = this.antibodies.filter((a) => !a.isAbsorbed);
  }

  getAll(): readonly Antibody[] {
    return this.antibodies;
  }
}
