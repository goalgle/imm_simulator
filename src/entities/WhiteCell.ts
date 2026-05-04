// 백혈구 엔티티.
// M1: DNA + 위치 + 렌더 핸들.
// M1.5: 위치/속도 + 마찰 + 화면 경계 반사 추가 (충격파 인터렉션 지원).
// M2~: 충돌, 약화, 회복은 추후 추가.

import type { DNA } from '../domain/dna';
import type { CellRenderer, CellRenderHandle } from '../render/CellRenderer';

// 게임: 화면 경계 박스. 세포가 이 안쪽에 머물도록 반사 처리.
export type Bounds = {
  width: number;
  height: number;
};

// 게임: 마찰 계수 (단위: 1/sec). 클수록 빨리 멈춤.
//        지수 감쇠: v(t+dt) = v(t) * exp(-FRICTION * dt)
//        값 1.5 면 약 0.5초에 절반, 2초 후 거의 정지.
const FRICTION = 1.5;

// 게임: 경계 반사 시 속도 보존율 (0=완전 흡수, 1=완전 탄성).
//        0.5 = 부드럽게 튕김.
const WALL_BOUNCE = 0.5;

// 게임: 충격파 자극으로 인한 시각 활성도(shockResponse) 의 회복 속도. 1/sec.
//        값 3.0 → 약 1초에 95% 회복.
const SHOCK_RECOVERY = 3.0;

export class WhiteCell {
  private handle: CellRenderHandle;
  vx = 0;
  vy = 0;
  // 게임: 충격파 임펄스로 인한 시각 활성도 (0~1). 매 프레임 지수 감쇠.
  //        ShockwaveSystem 이 임펄스 누적 시 applyShockImpulse 로 증가시킴.
  private shockResponse = 0;

  constructor(
    public readonly dna: DNA,
    renderer: CellRenderer,
    public x: number,
    public y: number,
    phase = 0,
  ) {
    this.handle = renderer.create(dna, x, y);
    this.handle.setPhase(phase);
  }

  // 게임: ShockwaveSystem 이 임펄스 적용 시 호출. amount 는 이번 프레임에 받은
  //        임펄스 정규화량 (0~∞). 누적되며 1.0 으로 캡.
  applyShockImpulse(amount: number): void {
    this.shockResponse = Math.min(1, this.shockResponse + amount);
  }

  // 게임: 매 프레임 씬에서 호출.
  //   t      : 게임 시작 후 경과 시간(초). 형태 함수에 전달.
  //   dt     : 이번 프레임 시간(초). 물리 적분에 사용.
  //   bounds : 화면 크기. 경계 반사용.
  update(t: number, dt: number, bounds: Bounds): void {
    // 게임: 위치 적분 (semi-implicit: 외부에서 vx/vy 가 갱신된 후 호출됨)
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 마찰 (지수 감쇠)
    const decay = Math.exp(-FRICTION * dt);
    this.vx *= decay;
    this.vy *= decay;

    // 게임: 경계 반사. base 반지름을 hitbox 로 사용 (시스템 기획서 §1.3).
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

    // 게임: 시각 활성도 감쇠 + 핸들 반영
    this.shockResponse *= Math.exp(-SHOCK_RECOVERY * dt);
    if (this.shockResponse < 0.001) this.shockResponse = 0;
    this.handle.setActivation(this.shockResponse);

    this.handle.setPosition(this.x, this.y);
    this.handle.update(t);
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.handle.setPosition(x, y);
  }

  destroy(): void {
    this.handle.destroy();
  }
}
