// 장면 1: 혈관 속 (매크로 뷰).
// M1.5: 호중구 N마리 + 충격파 인터렉션
// M2.1: + 영양분 풀(40, 4초 리젠) + 세균 (영양분 추적, 분열) — 백혈구는 아직 관전
// M2.2: + drives(우선순위) + 관성 + 동족 분리력

import Phaser from 'phaser';
import { NEUTROPHIL, BACTERIA_A } from '../domain/dna';
import { WhiteCell } from '../entities/WhiteCell';
import { GraphicsCellRenderer } from '../render/GraphicsCellRenderer';
import type { CellRenderer } from '../render/CellRenderer';
import { ShockwaveSystem } from '../systems/ShockwaveSystem';
import { ShockwaveRenderer } from '../render/ShockwaveRenderer';
import { NutrientSystem } from '../systems/NutrientSystem';
import { NutrientRenderer } from '../render/NutrientRenderer';
import { BacteriaBehaviorSystem } from '../systems/BacteriaBehaviorSystem';
import { applySeparation } from '../domain/separation';

// 게임: 초기 호중구 수.
const NEUTROPHIL_COUNT = 10;

// 게임: 초기 세균 수. 시스템 구현 기획서 §2.4 — 사회성 형질 도입 시 즉시 관찰 가능.
const BACTERIA_COUNT = 3;

// 게임: 영양분 슬롯 수 (고정). 소비 후 일정 지연 뒤 재활성화.
const NUTRIENT_COUNT = 40;
const NUTRIENT_MARGIN = 30;
const NUTRIENT_RESPAWN_DELAY = 4;

// 게임: 충격파 자원/파동 파라미터.
const SHOCKWAVE_CONFIG = {
  maxCharges: 5,
  rechargeIntervalSec: 3,
  waveTemplate: {
    speed: 280,
    duration: 1.2,
    power: 600,
    bandwidth: 50,
  },
};

// 게임: 분리력 파라미터. 같은 종족끼리 너무 붙는 것 방지.
//   padding  : base 합 외에 추가로 비워둘 거리
//   strength : 가속도 (px/s²). 강하면 빠르게 분리, 약하면 자연스럽게 떨어짐.
const SEPARATION_PADDING = 4;
const SEPARATION_STRENGTH = 400;

export class BloodScene extends Phaser.Scene {
  private cellRenderer!: CellRenderer;
  private shockwaveRenderer!: ShockwaveRenderer;
  private nutrientRenderer!: NutrientRenderer;
  private shockwaveSystem!: ShockwaveSystem;
  private nutrientSystem!: NutrientSystem;
  private bacteriaBehavior!: BacteriaBehaviorSystem;
  private cells: WhiteCell[] = [];
  private hudText!: Phaser.GameObjects.Text;

  constructor() {
    super('BloodScene');
  }

  // Phaser: 씬 시작 시 1회 호출.
  create(): void {
    const t0 = this.time.now / 1000;
    const W = this.scale.width;
    const H = this.scale.height;

    this.cellRenderer = new GraphicsCellRenderer(this);
    this.shockwaveRenderer = new ShockwaveRenderer(this);
    this.nutrientRenderer = new NutrientRenderer(this);

    this.shockwaveSystem = new ShockwaveSystem({
      ...SHOCKWAVE_CONFIG,
      initialTime: t0,
    });
    this.nutrientSystem = new NutrientSystem(
      NUTRIENT_COUNT,
      { width: W, height: H, margin: NUTRIENT_MARGIN },
      NUTRIENT_RESPAWN_DELAY,
    );
    this.bacteriaBehavior = new BacteriaBehaviorSystem(this.cellRenderer);

    // 게임: 호중구 무작위 배치.
    for (let i = 0; i < NEUTROPHIL_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      this.cells.push(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, phase));
    }

    // 게임: 세균 무작위 배치.
    for (let i = 0; i < BACTERIA_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
    }

    // Phaser: pointerdown = 마우스 클릭 + 터치 탭 둘 다 받음.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const t = this.time.now / 1000;
      this.shockwaveSystem.trySpawn(pointer.x, pointer.y, t);
    });

    this.add.text(20, 20, 'M2.2: drives + 관성 + 분리력', {
      color: '#aaa',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '14px',
    });
    this.hudText = this.add.text(20, 40, '', {
      color: '#fc8',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '14px',
    });
  }

  // Phaser: 매 프레임 호출. delta 는 ms.
  override update(_time: number, delta: number): void {
    const t = this.time.now / 1000;
    const dt = delta / 1000;
    const bounds = { width: this.scale.width, height: this.scale.height };

    // 게임: 1) 충격파 시스템 (자원, 만료 정리)
    this.shockwaveSystem.update(t);
    // 게임: 2) 영양분 시스템 (부활 처리)
    this.nutrientSystem.update(t);
    // 게임: 3) 충격파 임펄스를 백혈구에 적용 (영양분/세균은 영향 없음)
    this.shockwaveSystem.applyToCells(this.cells, t, dt);
    // 게임: 4) 같은 종족 분리력 — 너무 붙은 것 방지.
    //         두 종족 분리는 별도 호출 (다른 종 간 분리는 M3 충돌이 처리).
    applySeparation(this.cells, SEPARATION_PADDING, SEPARATION_STRENGTH, dt);
    applySeparation(
      this.bacteriaBehavior.getAll() as unknown as import('../domain/separation').SeparableEntity[],
      SEPARATION_PADDING,
      SEPARATION_STRENGTH,
      dt,
    );
    // 게임: 5) 백혈구 물리/렌더 갱신
    for (const cell of this.cells) cell.update(t, dt, bounds);
    // 게임: 6) 세균 행동 + 물리/렌더 (drives 평가, 관성, 분열 자식 생성).
    //         predators 인자로 백혈구 위치 전달.
    this.bacteriaBehavior.update(t, dt, bounds, this.nutrientSystem, this.cells);
    // 게임: 7) 시각화
    this.nutrientRenderer.draw(this.nutrientSystem.getAllSlots());
    this.shockwaveRenderer.draw(this.shockwaveSystem.getActiveWaves(), t);

    // 게임: HUD
    const charges = this.shockwaveSystem.getCharges();
    const maxCharges = this.shockwaveSystem.getMaxCharges();
    const bacteriaCount = this.bacteriaBehavior.getAll().length;
    this.hudText.setText(
      `charges: ${charges}/${maxCharges}   bacteria: ${bacteriaCount}`,
    );
  }
}
