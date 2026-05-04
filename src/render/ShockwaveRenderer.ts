// 충격파 시각화 — 활성 파동을 흰색 링으로 그림.
// Phaser.GameObjects.Graphics 1개에 모든 파동을 batch 로 그림 (link 수 적어 batch 효과 충분).

import Phaser from 'phaser';
import type { Shockwave } from '../domain/shockwave';
import { shockwaveRadius } from '../domain/shockwave';

export class ShockwaveRenderer {
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Phaser: Graphics 1개 = draw call 1개. 동시 활성 파동이 최대 5개 정도라 충분.
    this.gfx = scene.add.graphics();
  }

  // 게임: 매 프레임 호출. 이전 프레임 그림 지우고 다시 그림.
  draw(waves: readonly Shockwave[], t: number): void {
    this.gfx.clear();
    for (const wave of waves) {
      const radius = shockwaveRadius(wave, t);
      const age = t - wave.startTime;
      const lifeRatio = Math.max(0, Math.min(1, age / wave.duration));

      // 게임: 늙을수록 투명. 시작 직후가 가장 진함.
      const alpha = (1 - lifeRatio) * 0.7;

      // Phaser: lineStyle(width, color, alpha) — 다음 stroke* 호출의 선 스타일 설정.
      this.gfx.lineStyle(2, 0xffffff, alpha);
      this.gfx.strokeCircle(wave.x, wave.y, radius);
    }
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
