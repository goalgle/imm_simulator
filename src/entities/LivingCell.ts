// 살아있는 세포의 추상 베이스 — WhiteCell, Bacteria 의 공통 동작 집약.
//
// 공통 책임:
//   - 위치/속도 (vx, vy)
//   - HP (applyDamage, hpRatio, isDead)
//   - 시체 상태 (isSettled, isAbsorbed, updateAsCorpse: 중력 낙하 + 회색)
//   - 전투 시각 자극 (combatResponse, applyCombatStimulus, 회복 감쇠)
//   - 시각 통보 헬퍼 (applyAliveVisuals)
//
// 자식이 책임:
//   - updateAlive(t, dt, bounds) — 살아있을 때 행동/물리/시각
//   - 종족 고유 형질 (호중구의 shockResponse, 세균의 mitosis 등)
//   - onDeath() override — 사망 직후 정리 (예: 분열 중단)

import type { DNA } from '../domain/dna';
import type { CellRenderer, CellRenderHandle } from '../render/CellRenderer';

export type Bounds = {
  width: number;
  height: number;
};

// 게임: 모든 종 공통 — HP 비율 → 시각 스케일 매핑. 시체도 MIN_SCALE 유지.
export const MIN_SCALE = 0.5;

// 게임: 시체 낙하 가속도 (px/s²).
const GRAVITY = 80;
// 게임: 시체 옆 이동 감쇠 (1/sec). 빠르게 수직 낙하로 수렴.
const CORPSE_HORIZONTAL_DAMPING = 2.0;
// 게임: 전투 시각 자극(combatResponse) 회복 속도 (1/sec).
const COMBAT_RECOVERY = 4.0;

// 게임: 자식 클래스가 applyAliveVisuals 호출 시 옵션.
export type AliveVisualOptions = {
  // 게임: 충격파 등 추가 시각 자극 채널 (기본 0).
  shock?: number;
  // 게임: hpScale 외에 추가로 곱할 스케일 (예: 분열 펄스). 기본 1.
  scaleExtra?: number;
};

export abstract class LivingCell {
  protected handle: CellRenderHandle;
  vx = 0;
  vy = 0;
  protected combatResponse = 0;
  protected hp: number;
  // 게임: 대식세포가 흡수했음을 표시. BloodScene 이 매 프레임 끝에 청소.
  isAbsorbed = false;

  constructor(
    public readonly dna: DNA,
    renderer: CellRenderer,
    public x: number,
    public y: number,
    phase = 0,
    initialHp?: number,
  ) {
    this.handle = renderer.create(dna, x, y);
    this.handle.setPhase(phase);
    this.hp = initialHp ?? dna.combat.maxHp;
  }

  // 게임: ContactSystem 이 매 프레임 접촉 중일 때 호출.
  applyCombatStimulus(amount: number): void {
    if (this.isDead()) return;
    this.combatResponse = Math.min(1, this.combatResponse + amount);
  }

  applyDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }

  hpRatio(): number {
    const max = this.dna.combat.maxHp;
    return max > 0 ? this.hp / max : 0;
  }

  isDead(): boolean {
    return this.hp <= 0;
  }

  // 게임: 침전된 시체 = 죽었고 + 화면 바닥에서 정지. 대식세포 흡수 대상.
  isSettled(): boolean {
    return this.isDead() && this.vy === 0 && this.vx === 0;
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.handle.setPosition(x, y);
  }

  destroy(): void {
    this.handle.destroy();
  }

  // 게임: 매 프레임 호출. 사망 여부에 따라 분기.
  update(t: number, dt: number, bounds: Bounds): void {
    if (this.isDead()) {
      this.updateAsCorpse(t, dt, bounds);
    } else {
      this.updateAlive(t, dt, bounds);
    }
  }

  // 자식이 구현 — 살아있을 때 행동/물리/시각.
  protected abstract updateAlive(t: number, dt: number, bounds: Bounds): void;

  // 자식 hook — 사망으로 전환되는 시점에 정리할 일이 있을 때 override.
  protected onDeath(): void {}

  // 게임: 시체 처리 — 행동/충돌 모두 정지, 중력만 작용. 화면 바닥(큰 Y)에 침전.
  protected updateAsCorpse(t: number, dt: number, bounds: Bounds): void {
    this.onDeath();

    // 게임: 옆 이동 감쇠 → 거의 수직 낙하
    this.vx *= Math.exp(-CORPSE_HORIZONTAL_DAMPING * dt);
    // 게임: 중력
    this.vy += GRAVITY * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 바닥 도달 시 침전 (vy=0, vx=0).
    const floor = bounds.height - this.dna.shape.base * MIN_SCALE;
    if (this.y >= floor) {
      this.y = floor;
      this.vy = 0;
      this.vx = 0;
    }

    // 게임: 시체 시각 — life=0 → 회색, 떨림 정지. 크기는 MIN_SCALE 유지.
    this.handle.setScale(MIN_SCALE);
    this.handle.setVisualState({ shock: 0, combat: 0, life: 0 });
    this.handle.setPosition(this.x, this.y);
    this.handle.update(t);
  }

  // 게임: 자식이 살아있을 때 update 끝에 호출 — combatResponse 감쇠 + 시각 통보.
  //   options.shock: 충격파 활성도 (호중구 등)
  //   options.scaleExtra: hpScale 곱셈 외 추가 배율 (분열 펄스 등)
  protected applyAliveVisuals(t: number, dt: number, options: AliveVisualOptions = {}): void {
    this.combatResponse *= Math.exp(-COMBAT_RECOVERY * dt);
    if (this.combatResponse < 0.001) this.combatResponse = 0;

    const hpScale = MIN_SCALE + (1 - MIN_SCALE) * this.hpRatio();
    const finalScale = hpScale * (options.scaleExtra ?? 1);
    this.handle.setScale(finalScale);
    this.handle.setVisualState({
      shock: options.shock ?? 0,
      combat: this.combatResponse,
      life: 1,
    });
    this.handle.setPosition(this.x, this.y);
    this.handle.update(t);
  }
}
