// 백혈구 엔티티 — 호중구 / 슈퍼 호중구 등.
// LivingCell 베이스를 상속하여 hp/combatResponse/시체 처리는 공통.
// 추가 책임: 충격파 시각 자극(shockResponse), 마찰, 화면 경계 반사.

import type { DNA } from '../domain/dna';
import type { CellRenderer } from '../render/CellRenderer';
import { LivingCell, type Bounds } from './LivingCell';

// 게임: 마찰 계수 (1/sec). 충격파로 가속된 후 자연 감속.
const FRICTION = 1.5;

// 게임: 경계 반사 시 속도 보존율 (0=흡수, 1=완전 탄성).
const WALL_BOUNCE = 0.5;

// 게임: 충격파 시각 활성도(shockResponse) 회복 속도 (1/sec). 약 1초에 95% 회복.
const SHOCK_RECOVERY = 3.0;

// 게임: 약화 임계 — HP 비율 이 미만이면 동료 흡수 대상 / 자기는 동료에게 의지.
export const WEAK_HP_THRESHOLD = 0.25;

export class WhiteCell extends LivingCell {
  private shockResponse = 0;
  // 게임: 동료 흡수 누적 카운터. 2 도달 시 슈퍼 호중구로 변환 (NEUTROPHIL 만 적용).
  mergeCounter = 0;
  // 게임: 항체 발사 쿨다운 남은 시간 (초). B세포만 사용. ≤ 0 도달 시 발사 가능.
  fireCooldownRemaining = 0;
  // 게임: 호중구 레벨 (NEUTROPHIL 만 사용). T세포 commandRange 안에서 세균 죽이면 +1.
  //        5 도달 시 NK/BCELL/SUPER 중 무작위 진화 (BloodScene 처리).
  level = 0;

  constructor(
    dna: DNA,
    renderer: CellRenderer,
    x: number,
    y: number,
    phase = 0,
    initialHp?: number,
  ) {
    super(dna, renderer, x, y, phase, initialHp);
  }

  applyShockImpulse(amount: number): void {
    if (this.isDead()) return;
    this.shockResponse = Math.min(1, this.shockResponse + amount);
  }

  // 게임: HP 가 임계 미만이면 약화 — 동료에게 흡수 대상.
  isWeak(): boolean {
    return !this.isDead() && this.hpRatio() < WEAK_HP_THRESHOLD;
  }

  protected override updateAlive(t: number, dt: number, bounds: Bounds): void {
    // 게임: 위치 적분
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 마찰
    const decay = Math.exp(-FRICTION * dt);
    this.vx *= decay;
    this.vy *= decay;

    // 게임: 경계 반사 (baseRadius 기준)
    const r = this.dna.shape.base;
    if (this.x < r) {
      this.x = r;
      if (this.vx < 0) this.vx = -this.vx * WALL_BOUNCE;
    } else if (this.x > bounds.width - r) {
      this.x = bounds.width - r;
      if (this.vx > 0) this.vx = -this.vx * WALL_BOUNCE;
    }
    if (this.y < r) {
      this.y = r;
      if (this.vy < 0) this.vy = -this.vy * WALL_BOUNCE;
    } else if (this.y > bounds.height - r) {
      this.y = bounds.height - r;
      if (this.vy > 0) this.vy = -this.vy * WALL_BOUNCE;
    }

    // 게임: 충격파 활성도 감쇠
    this.shockResponse *= Math.exp(-SHOCK_RECOVERY * dt);
    if (this.shockResponse < 0.001) this.shockResponse = 0;

    this.applyAliveVisuals(t, dt, { shock: this.shockResponse });
  }
}
