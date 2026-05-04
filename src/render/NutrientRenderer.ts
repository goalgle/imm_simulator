// 영양분 시각화. 단일 Graphics 객체에 모든 점을 batch 로 그림.
// 영양분은 정지 + 작은 점이라 폴리곤 변형 불필요 — 단순 fillCircle 로 충분.

import Phaser from 'phaser';
import type { Nutrient } from '../entities/Nutrient';

// 게임: 시각 파라미터.
const NUTRIENT_RADIUS = 3;            // 점의 반지름 (px)
const NUTRIENT_COLOR = 0xfff4b8;      // 연한 노란빛 (영양 느낌)
const NUTRIENT_ALPHA = 0.85;

export class NutrientRenderer {
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Phaser: Graphics 1개에 N개 fillCircle 호출 → batch 1회. 40개 영양분도 가볍다.
    //         정적이라 매 프레임 redraw 필요 없을 수도 있지만, NutrientSystem.consume()
    //         으로 위치가 바뀌므로 매 프레임 갱신하는 편이 단순.
    this.gfx = scene.add.graphics();
  }

  draw(nutrients: readonly Nutrient[]): void {
    this.gfx.clear();
    this.gfx.fillStyle(NUTRIENT_COLOR, NUTRIENT_ALPHA);
    for (const n of nutrients) {
      if (!n.active) continue;
      this.gfx.fillCircle(n.x, n.y, NUTRIENT_RADIUS);
    }
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
