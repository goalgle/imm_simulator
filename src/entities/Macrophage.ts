// 대식세포 (Macrophage) 엔티티.
// 시스템 구현 기획서 §M5.4 — 시체 청소 + 호중구 재생산.
//
// 특징:
//   - 화면 바닥(Y = bounds.height - r)에 고정. Y 이동 없음.
//   - X 좌우로만 이동.
//   - 다른 종족(호중구/세균)과 충돌 X — 다른 레인.
//   - 충격파 영향 X — 정해진 동선만 따름.
//   - HP/공격력 무관 (전투 없음).
//
// 시체 흡수 + 점수 누적 + 호중구 재생산은 MacrophageSystem 이 담당.

import type { DNA } from '../domain/dna';
import type { CellRenderer, CellRenderHandle } from '../render/CellRenderer';

export class Macrophage {
  private handle: CellRenderHandle;
  vx = 0;

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

  // 게임: 매 프레임 호출. y 는 외부에서 강제 (바닥 고정).
  update(t: number, dt: number, floorY: number): void {
    this.x += this.vx * dt;
    this.y = floorY;
    this.handle.setPosition(this.x, this.y);
    // 게임: 시각 — 평상 상태. 스케일 1.0, 활성도 0, life 1.
    this.handle.setScale(1.0);
    this.handle.setVisualState({ shock: 0, combat: 0, life: 1 });
    this.handle.update(t);
  }

  destroy(): void {
    this.handle.destroy();
  }
}
