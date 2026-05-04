// CellRenderer 구현체 — Phaser.GameObjects.Graphics + fillPoints 기반.
// M0 측정 결과(시스템 구현 기획서 §1.2)에 따른 채택.
// 핵심: 매 프레임 generatePolygon → graphics.clear → fillPoints.
//
// M3.2 부터 활성도(activation 0~1) 를 받아 시각을 강조:
//   - 색: 채도 ↑, 명도 ↓ (어둡고 진하게)
//   - 형태 떨림 진폭 ↑ (출렁임)
//   스케일 변화는 setScale 로 별도 처리 (분열 애니메이션과 펄스 효과를 동시에 합성하기 위함).

import Phaser from 'phaser';
import type { DNA } from '../domain/dna';
import { hslToRgbInt } from '../domain/color';
import { generatePolygon, type Point } from '../domain/shapeFunction';
import type { CellRenderer, CellRenderHandle } from './CellRenderer';

// 게임: polygon 정밀도. 32 면 시각적으로 부드럽고 M0 에서 5000개 60fps 통과.
const VERTEX_COUNT = 32;

// 게임: 활성도 1 일 때의 색/형태 변환량.
const ACTIVE_S_BOOST = 15;     // 채도 (0~100 단위)
const ACTIVE_L_DROP = 25;       // 명도 (0~100 단위, - 방향)
const ACTIVE_AMP_BOOST = 0.5;   // 진폭 배율 추가분 (1.0 → 1.5)

class GraphicsHandle implements CellRenderHandle {
  private gfx: Phaser.GameObjects.Graphics;
  private dna: DNA;
  private phase = 0;
  private activation = 0;
  // 게임: vertex 객체 재사용 버퍼. 매 프레임 새 배열 할당을 피해 GC 부담 감소.
  private buffer: Point[];

  constructor(scene: Phaser.Scene, dna: DNA, x: number, y: number) {
    this.gfx = scene.add.graphics({ x, y });
    this.dna = dna;
    this.buffer = new Array(VERTEX_COUNT);
    for (let i = 0; i < VERTEX_COUNT; i++) this.buffer[i] = { x: 0, y: 0 };
  }

  setPosition(x: number, y: number): void {
    this.gfx.setPosition(x, y);
  }

  setPhase(phase: number): void {
    this.phase = phase;
  }

  setScale(scale: number): void {
    this.gfx.setScale(scale);
  }

  setActivation(level: number): void {
    // 게임: 안전하게 0~1 로 클램프.
    this.activation = level < 0 ? 0 : level > 1 ? 1 : level;
  }

  update(t: number): void {
    // 게임: 활성도 → 색 (HSL 보정 후 RGB 변환). 매 프레임 호출이지만
    //       세포당 sin/cos 계산에 비하면 hslToRgbInt 비용은 무시 가능.
    const c = this.dna.color;
    const s = c.s + ACTIVE_S_BOOST * this.activation;
    const l = c.l - ACTIVE_L_DROP * this.activation;
    const color = hslToRgbInt(c.h, clamp01x100(s), clamp01x100(l));

    // 게임: 활성도 → 진폭 배율 (떨림 강조).
    const ampBoost = 1 + ACTIVE_AMP_BOOST * this.activation;

    generatePolygon(this.dna, t, VERTEX_COUNT, this.phase, ampBoost, this.buffer);

    this.gfx.clear();
    this.gfx.fillStyle(color, 1);
    this.gfx.fillPoints(this.buffer, true);
  }

  destroy(): void {
    this.gfx.destroy();
  }
}

function clamp01x100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

export class GraphicsCellRenderer implements CellRenderer {
  constructor(private scene: Phaser.Scene) {}

  create(dna: DNA, x: number, y: number): CellRenderHandle {
    return new GraphicsHandle(this.scene, dna, x, y);
  }
}
