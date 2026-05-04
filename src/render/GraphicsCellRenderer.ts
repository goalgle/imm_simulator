// CellRenderer 구현체 — Phaser.GameObjects.Graphics + fillPoints 기반.
// M0 측정 결과(시스템 구현 기획서 §1.2)에 따른 채택.
// 핵심: 매 프레임 generatePolygon → graphics.clear → fillPoints.

import Phaser from 'phaser';
import type { DNA } from '../domain/dna';
import { hslToRgbInt } from '../domain/color';
import { generatePolygon, type Point } from '../domain/shapeFunction';
import type { CellRenderer, CellRenderHandle } from './CellRenderer';

// 게임: polygon 정밀도. 32 면 시각적으로 부드럽고 M0 에서 5000개 60fps 통과.
//       시각 품질 ↑ 가 필요하면 48~64 로 상향. 성능 한계 시 24 로 하향.
const VERTEX_COUNT = 32;

class GraphicsHandle implements CellRenderHandle {
  // Phaser: Graphics 는 동적 polygon/도형 그리기용 GameObject.
  //         자체 transform(x, y, scale, rotation) 을 가지므로
  //         polygon 좌표는 로컬(0,0 기준) 으로 그리고 위치는 transform 에 위임.
  private gfx: Phaser.GameObjects.Graphics;
  private dna: DNA;
  private phase = 0;
  private color: number;
  // 게임: vertex 객체 재사용 버퍼. 매 프레임 새 배열 할당을 피해 GC 부담 감소.
  private buffer: Point[];

  constructor(scene: Phaser.Scene, dna: DNA, x: number, y: number) {
    // Phaser: scene.add.graphics({ x, y }) 로 위치 지정하며 생성.
    this.gfx = scene.add.graphics({ x, y });
    this.dna = dna;
    this.color = hslToRgbInt(dna.color.h, dna.color.s, dna.color.l);
    this.buffer = new Array(VERTEX_COUNT);
    for (let i = 0; i < VERTEX_COUNT; i++) this.buffer[i] = { x: 0, y: 0 };
  }

  // Phaser: setPosition 은 GameObject 표준 API. graphics 의 transform 만 갱신.
  setPosition(x: number, y: number): void {
    this.gfx.setPosition(x, y);
  }

  setPhase(phase: number): void {
    this.phase = phase;
  }

  // Phaser: setScale 은 GameObject 표준 API. graphics 의 transform 으로 처리되어
  //         polygon 좌표 자체는 손대지 않음 (성능 영향 없음).
  setScale(scale: number): void {
    this.gfx.setScale(scale);
  }

  update(t: number): void {
    // 게임: 로컬 좌표로 polygon 갱신 (버퍼 재사용).
    generatePolygon(this.dna, t, VERTEX_COUNT, this.phase, this.buffer);

    // Phaser: clear() 로 이전 프레임 path 제거 → 새로 채우기.
    this.gfx.clear();
    this.gfx.fillStyle(this.color, 1);
    // Phaser: fillPoints(points, closeShape) — closeShape=true 면 마지막→첫 점 자동 연결.
    this.gfx.fillPoints(this.buffer, true);
  }

  destroy(): void {
    this.gfx.destroy();
  }
}

export class GraphicsCellRenderer implements CellRenderer {
  constructor(private scene: Phaser.Scene) {}

  create(dna: DNA, x: number, y: number): CellRenderHandle {
    return new GraphicsHandle(this.scene, dna, x, y);
  }
}
