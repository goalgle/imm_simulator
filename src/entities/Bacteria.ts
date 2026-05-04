// 세균 엔티티.
// 시스템 구현 기획서 §2.4 — 영양분 추적 + 분열 동기.
// 행동 자체는 BacteriaBehaviorSystem 이 담당하고, Bacteria 는 자기 상태와 렌더만 책임.

import type { DNA } from '../domain/dna';
import type { CellRenderer, CellRenderHandle } from '../render/CellRenderer';

// 게임: 분열 진행 중 상태. 흡수 카운터가 임계치 도달하면 시작됨.
export type MitosisState = {
  startTime: number;
  duration: number;
} | null;

// 게임: 분열 시각 효과 파라미터.
const MITOSIS_DURATION = 0.5;        // 분열에 걸리는 시간(초)
const MITOSIS_PEAK_SCALE = 1.4;      // 절정 시각 배율 (1.0 → 1.4)

// 게임: 영양분 흡수 가능한 거리. base 값에 영양분 점 반지름(3) 을 더한 것.
const ABSORB_RADIUS_BONUS = 5;

// 게임: 영양분 N 개 흡수 시 분열.
const MITOSIS_THRESHOLD = 3;

export class Bacteria {
  private handle: CellRenderHandle;
  vx = 0;
  vy = 0;
  absorbCounter = 0;
  mitosis: MitosisState = null;
  // 게임: 분열 완료 신호. BacteriaBehaviorSystem 이 매 프레임 확인해 자식을 추가.
  pendingSpawn = false;

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

  // 게임: 분열 거리 — 영양분과의 흡수 가능 반경.
  absorbRadius(): number {
    return this.dna.shape.base + ABSORB_RADIUS_BONUS;
  }

  // 게임: 카운터 증가 + 임계치 도달 시 분열 시작.
  registerAbsorb(t: number): void {
    this.absorbCounter++;
    if (this.absorbCounter >= MITOSIS_THRESHOLD && this.mitosis === null) {
      this.mitosis = { startTime: t, duration: MITOSIS_DURATION };
    }
  }

  // 게임: 매 프레임 호출. 위치 적분, 분열 진행, 렌더 갱신.
  //   t      : 게임 시작 후 경과 시간(초)
  //   dt     : 이번 프레임 시간(초)
  //   bounds : 화면 크기 (경계 클램핑용)
  update(t: number, dt: number, bounds: { width: number; height: number }): void {
    // 게임: 위치 적분
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 화면 경계 클램핑 (세균은 벽에 튕기지 않고 그냥 멈춤)
    const r = this.dna.shape.base;
    if (this.x < r) {
      this.x = r;
      if (this.vx < 0) this.vx = 0;
    } else if (this.x > bounds.width - r) {
      this.x = bounds.width - r;
      if (this.vx > 0) this.vx = 0;
    }
    if (this.y < r) {
      this.y = r;
      if (this.vy < 0) this.vy = 0;
    } else if (this.y > bounds.height - r) {
      this.y = bounds.height - r;
      if (this.vy > 0) this.vy = 0;
    }

    // 게임: 분열 진행 중이면 시각 스케일 갱신
    if (this.mitosis !== null) {
      const progress = (t - this.mitosis.startTime) / this.mitosis.duration;
      if (progress >= 1.0) {
        // 게임: 분열 완료. 자식 생성은 시스템이 처리 (pendingSpawn 플래그).
        this.pendingSpawn = true;
        this.mitosis = null;
        this.absorbCounter = 0;
        this.handle.setScale(1.0);
      } else {
        // 게임: 0~1 → 1.0 ~ peak ~ 1.0 (사인 곡선처럼 부풀었다가 돌아옴)
        const bell = Math.sin(progress * Math.PI);
        const scale = 1.0 + (MITOSIS_PEAK_SCALE - 1.0) * bell;
        this.handle.setScale(scale);
      }
    }

    this.handle.setPosition(this.x, this.y);
    this.handle.update(t);
  }

  destroy(): void {
    this.handle.destroy();
  }
}
