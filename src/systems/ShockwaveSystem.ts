// 충격파 시스템 — 활성 파동 풀 + 자원(charges) 관리.
// 매 프레임:
//   1) update(t): 만료 파동 제거, 시간 경과만큼 자원 충전
//   2) applyToCells(cells, t, dt): 모든 활성 파동의 임펄스 합산하여 세포 속도에 누적
//
// 이 파일은 Phaser 의존 없음 (도메인 + 엔티티만 의존).

import type { Shockwave } from '../domain/shockwave';
import { isShockwaveAlive, shockwaveImpulse } from '../domain/shockwave';
import type { WhiteCell } from '../entities/WhiteCell';

// 게임: 임펄스 크기 → 시각 활성도 환산 게인.
//        값이 클수록 약한 충격에도 시각 반응이 강함.
const SHOCK_ACTIVATION_GAIN = 0.1;

// 게임: 시스템 초기 설정.
//   maxCharges          : 동시 보유 가능한 최대 발수
//   rechargeIntervalSec : 1발 충전에 걸리는 시간(초)
//   waveTemplate        : 발사 시 생성되는 파동의 기본 파라미터
export type ShockwaveSystemConfig = {
  maxCharges: number;
  rechargeIntervalSec: number;
  waveTemplate: Omit<Shockwave, 'x' | 'y' | 'startTime'>;
  initialTime: number;
};

export class ShockwaveSystem {
  private waves: Shockwave[] = [];
  private charges: number;
  private readonly maxCharges: number;
  private readonly rechargeIntervalSec: number;
  private readonly waveTemplate: Omit<Shockwave, 'x' | 'y' | 'startTime'>;
  private lastRechargeTime: number;

  constructor(cfg: ShockwaveSystemConfig) {
    this.charges = cfg.maxCharges;
    this.maxCharges = cfg.maxCharges;
    this.rechargeIntervalSec = cfg.rechargeIntervalSec;
    this.waveTemplate = cfg.waveTemplate;
    this.lastRechargeTime = cfg.initialTime;
  }

  // 게임: 자원이 있으면 1발 소모하고 파동 생성. 없으면 false.
  trySpawn(x: number, y: number, t: number): boolean {
    if (this.charges <= 0) return false;
    this.charges--;
    this.waves.push({
      x,
      y,
      startTime: t,
      ...this.waveTemplate,
    });
    return true;
  }

  // 게임: 자원 충전 + 만료 파동 제거. 매 프레임 1회.
  update(t: number): void {
    while (
      t - this.lastRechargeTime >= this.rechargeIntervalSec &&
      this.charges < this.maxCharges
    ) {
      this.charges++;
      this.lastRechargeTime += this.rechargeIntervalSec;
    }
    // 게임: 가득 차 있으면 충전 타이머를 t 로 끌어와서 다음 발사 직후부터 다시 카운트.
    if (this.charges >= this.maxCharges) {
      this.lastRechargeTime = t;
    }
    this.waves = this.waves.filter((w) => isShockwaveAlive(w, t));
  }

  // 게임: 모든 활성 파동의 임펄스를 합산하여 세포 속도에 적용.
  //        한 세포가 여러 파동의 영향권에 동시에 있어도 각각 합산됨.
  //        임펄스 강도는 시각 활성도(shockResponse) 에도 비례 누적 — 강한 충격 → 강한 반응.
  applyToCells(cells: readonly WhiteCell[], t: number, dt: number): void {
    if (this.waves.length === 0) return;
    for (const cell of cells) {
      // 게임: 시체는 충격파 영향 X. 중력만 작용.
      if (cell.isDead()) continue;
      let dvx = 0;
      let dvy = 0;
      let impulseMag = 0;
      for (const wave of this.waves) {
        const imp = shockwaveImpulse(wave, cell.x, cell.y, t);
        dvx += imp.dvx;
        dvy += imp.dvy;
        impulseMag += Math.sqrt(imp.dvx * imp.dvx + imp.dvy * imp.dvy);
      }
      cell.vx += dvx * dt;
      cell.vy += dvy * dt;
      if (impulseMag > 0) {
        // 게임: 정규화 — 충격파 power(600 px/s²) × dt(0.016) ≈ 10 정도가 1프레임 임펄스의 큰 값.
        //        이를 0~1 활성도로 환산: × SHOCK_ACTIVATION_GAIN.
        cell.applyShockImpulse(impulseMag * dt * SHOCK_ACTIVATION_GAIN);
      }
    }
  }

  getActiveWaves(): readonly Shockwave[] {
    return this.waves;
  }

  getCharges(): number {
    return this.charges;
  }

  getMaxCharges(): number {
    return this.maxCharges;
  }
}
