// CellRenderer 구현체 — Phaser.GameObjects.Graphics + fillPoints 기반.
// M0 측정 결과(시스템 구현 기획서 §1.2)에 따른 채택.
// 핵심: 매 프레임 generatePolygon → graphics.clear → fillPoints.
//
// M3.4 부터 시각 채널 3개 합성:
//   - shock  : 채도 ↑ + 명도 ↓ + ampBoost ↑   (자기 색이 진해짐)
//   - combat : hue 를 빨강(0°) 쪽으로 lerp + ampBoost ↑   (다른 색이 됨)
//   - life   : 0 일 때 채도 0 (회색) + ampBoost ×0 (떨림 정지)

import Phaser from 'phaser';
import type { DNA } from '../domain/dna';
import { hslToRgbInt } from '../domain/color';
import { generatePolygon, type Point } from '../domain/shapeFunction';
import type { CellRenderer, CellRenderHandle, VisualState } from './CellRenderer';

const VERTEX_COUNT = 32;

// 게임: 충격파 활성도 1 일 때의 색/형태 변환량.
const SHOCK_S_BOOST = 15;
const SHOCK_L_DROP = 25;
const SHOCK_AMP_BOOST = 0.5;

// 게임: 전투 활성도 1 일 때. shock 와 다른 채널이라 합성 가능.
//   combat 은 hue 를 빨강 쪽으로 lerp 시켜 "다른 색"으로 보이게 함.
const COMBAT_TARGET_HUE = 0;       // 빨강
const COMBAT_HUE_PULL = 0.6;       // 활성도 1 일 때 base hue → COMBAT_TARGET_HUE 까지 60% lerp
const COMBAT_S_BOOST = 20;         // 빨강쪽이라도 채도 살짝 ↑
const COMBAT_AMP_BOOST = 0.4;      // shock 와 별개 ampBoost 추가

// 게임: 죽으면 색 잃음. life=0 → 채도 0. (명도는 유지하여 "회색 시체" 시각).
//        형태 떨림도 0 → 정적 시체.

class GraphicsHandle implements CellRenderHandle {
  private gfx: Phaser.GameObjects.Graphics;
  private dna: DNA;
  private phase = 0;
  private visual: VisualState = { shock: 0, combat: 0, life: 1 };
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

  setScale(scaleX: number, scaleY?: number): void {
    this.gfx.setScale(scaleX, scaleY ?? scaleX);
  }

  setAlpha(alpha: number): void {
    this.gfx.setAlpha(alpha);
  }

  setVisualState(state: VisualState): void {
    this.visual.shock = clamp01(state.shock);
    this.visual.combat = clamp01(state.combat);
    this.visual.life = clamp01(state.life);
  }

  update(t: number): void {
    const c = this.dna.color;
    const { shock, combat, life } = this.visual;

    // 게임: hue — 평소 base, 전투 활성도에 따라 빨강(0°) 쪽으로 lerp.
    //        wrap-around 고려 안 함 — 빨강은 0° 라 단방향 lerp 으로 충분.
    const h = c.h + (COMBAT_TARGET_HUE - c.h) * (combat * COMBAT_HUE_PULL);

    // 게임: 채도 — base + shock + combat 부스트, 그러나 life 곱 (죽으면 0).
    const sRaw = c.s + SHOCK_S_BOOST * shock + COMBAT_S_BOOST * combat;
    const s = sRaw * life;

    // 게임: 명도 — shock 만 어둡게. combat/life 는 명도 영향 X (회색 시체는 채도 0 으로 충분).
    const l = c.l - SHOCK_L_DROP * shock;

    const color = hslToRgbInt(h, clamp01x100(s), clamp01x100(l));

    // 게임: 진폭 — 평소 1, 자극으로 ↑, 죽으면 0 (정적 시체).
    const ampBoost = (1 + SHOCK_AMP_BOOST * shock + COMBAT_AMP_BOOST * combat) * life;

    generatePolygon(this.dna, t, VERTEX_COUNT, this.phase, ampBoost, this.buffer);

    this.gfx.clear();
    this.gfx.fillStyle(color, 1);
    this.gfx.fillPoints(this.buffer, true);
  }

  destroy(): void {
    this.gfx.destroy();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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
