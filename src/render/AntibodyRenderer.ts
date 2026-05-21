// 항체 시각화. 단일 Graphics 객체에 모든 점을 batch 로 그림.
// 영양분(노란빛)과 구분되는 보라 점.

import Phaser from 'phaser';
import type { Antibody } from '../entities/Antibody';

const ANTIBODY_RADIUS = 3;
const ANTIBODY_COLOR_ACTIVE = 0xb070ff;   // 진한 보라 (이동 중)
const ANTIBODY_COLOR_STOPPED = 0x7050b0;  // 어두운 보라 (정지/지뢰)
const ANTIBODY_ALPHA = 0.9;

export class AntibodyRenderer {
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
  }

  draw(antibodies: readonly Antibody[]): void {
    this.gfx.clear();
    // 게임: 이동 중 / 정지 두 색 분리. 같은 fillStyle 묶어 batch 효율 ↑.
    this.gfx.fillStyle(ANTIBODY_COLOR_ACTIVE, ANTIBODY_ALPHA);
    for (const ab of antibodies) {
      if (ab.isStopped || ab.isAbsorbed) continue;
      this.gfx.fillCircle(ab.x, ab.y, ANTIBODY_RADIUS);
    }
    this.gfx.fillStyle(ANTIBODY_COLOR_STOPPED, ANTIBODY_ALPHA);
    for (const ab of antibodies) {
      if (!ab.isStopped || ab.isAbsorbed) continue;
      this.gfx.fillCircle(ab.x, ab.y, ANTIBODY_RADIUS);
    }
  }

  // 게임: 화면 표시 토글 — EntityRegistry.antibody.visible 반영.
  setVisible(visible: boolean): void {
    this.gfx.setVisible(visible);
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
