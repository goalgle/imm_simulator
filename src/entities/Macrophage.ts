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
  // 게임: 유저 수동 조작 (Session 19). manualUntil = gameTime 기준 만료 시각, 0 이면 비활성.
  //   BloodScene 의 cursor 키 isDown 매 프레임 갱신. MacrophageSystem 가 t < manualUntil 이면
  //   vx = manualDirX * speed 로 사용자 입력 따라가고, nearest 시체 추적 로직 skip.
  //   키 떼도 manualUntil 까지 마지막 방향 드리프트 → 만료 시 자동 모드 복귀.
  manualUntil = 0;
  manualDirX: -1 | 0 | 1 = 0;
  // 게임: 영역 (zone) 경계 — MacrophageSystem 가 매 프레임 갱신. 화면을 대식세포 수로 등분.
  //   기본값은 사실상 무제한 (초기 1프레임 동안만 — 시스템이 즉시 덮어씀).
  zoneMinX = 0;
  zoneMaxX = Number.POSITIVE_INFINITY;

  constructor(
    public readonly dna: DNA,
    renderer: CellRenderer,
    public x: number,
    public y: number,
    phase = 0,
  ) {
    this.handle = renderer.create(dna, x, y);
    this.handle.setPhase(phase);
    // 게임: 대식세포는 바닥을 기는 형태 — handle.y = 바닥 위치, polygon 의 위쪽만 dome 으로 표시.
    this.handle.setFlatBottom(true);
  }

  // 게임: 매 프레임 호출. y 는 외부에서 강제 (바닥 고정). x 는 zone 경계로 클램프.
  update(t: number, dt: number, floorY: number): void {
    this.x += this.vx * dt;
    // 게임: zone 경계 클램프 — 자기 구역 밖으로 못 나감. 경계 도달 시 vx 0 (관성 차단).
    if (this.x < this.zoneMinX) { this.x = this.zoneMinX; this.vx = 0; }
    else if (this.x > this.zoneMaxX) { this.x = this.zoneMaxX; this.vx = 0; }
    this.y = floorY;
    this.handle.setPosition(this.x, this.y);
    // 게임: 기어다니는 느낌 — vx 가 있을 때 squash-and-stretch.
    //   걸음 주기 ~1.05Hz (cycle 6.6 rad/s). gait = sin(t × cycle).
    //     stretchX = 1.0 + gait × 0.10 → 1.10 ~ 0.90 (가로 늘었다 줄었다)
    //     stretchY = 0.55 − gait × 0.06 → 0.49 ~ 0.61 (반대 위상 = 발걸음의 압축)
    //   정지 시: 가벼운 호흡 (sin(t × 1.5) × ±0.02) — 살아있는 느낌 유지.
    const speed = Math.abs(this.vx);
    if (speed > 1) {
      const gait = Math.sin(t * 6.6);
      this.handle.setScale(1.0 + gait * 0.10, 0.55 - gait * 0.06);
    } else {
      const breath = Math.sin(t * 1.5) * 0.02;
      this.handle.setScale(1.0 + breath, 0.55 - breath);
    }
    this.handle.setVisualState({ shock: 0, combat: 0, life: 1 });
    this.handle.update(t);
  }

  // 게임: 화면 표시 토글 — 컷신 / 디버그가 가시화 제어. 행동/충돌과 별개.
  setVisible(visible: boolean): void {
    this.handle.setVisible(visible);
  }

  destroy(): void {
    this.handle.destroy();
  }
}
