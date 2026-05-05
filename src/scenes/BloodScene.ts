// 장면 1: 혈관 속 (매크로 뷰).
// M1.5: 호중구 N마리 + 충격파 인터렉션
// M2.1: + 영양분 풀(40, 4초 리젠) + 세균 (영양분 추적, 분열) — 백혈구는 아직 관전
// M2.2: + drives(우선순위) + 관성 + 동족 분리력

import Phaser from 'phaser';
import { NEUTROPHIL, NEUTROPHIL_SUPER, BACTERIA_A, BACTERIA_COMMANDER, MACROPHAGE } from '../domain/dna';
import { WhiteCell } from '../entities/WhiteCell';
import { Macrophage } from '../entities/Macrophage';
import { GraphicsCellRenderer } from '../render/GraphicsCellRenderer';
import type { CellRenderer } from '../render/CellRenderer';
import { ShockwaveSystem } from '../systems/ShockwaveSystem';
import { ShockwaveRenderer } from '../render/ShockwaveRenderer';
import { NutrientSystem } from '../systems/NutrientSystem';
import { NutrientRenderer } from '../render/NutrientRenderer';
import { BacteriaBehaviorSystem } from '../systems/BacteriaBehaviorSystem';
import { WhiteCellBehaviorSystem } from '../systems/WhiteCellBehaviorSystem';
import { ContactSystem } from '../systems/ContactSystem';
import { TeamSystem } from '../systems/TeamSystem';
import { MacrophageSystem } from '../systems/MacrophageSystem';
import { applySeparation } from '../domain/separation';

// 게임: 초기 호중구 수.
const NEUTROPHIL_COUNT = 10;

// 게임: 초기 세균 수. 시스템 구현 기획서 §2.4 — 사회성 형질 도입 시 즉시 관찰 가능.
const BACTERIA_COUNT = 3;

// 게임: 초기 커맨더 수 (M5.1). 분열 안 하므로 사망 시까지 유지.
const COMMANDER_COUNT = 1;

// 게임: 초기 대식세포 수 (M5.4a).
const MACROPHAGE_COUNT = 1;

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

// 게임: HUD 표시 헬퍼.
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

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
  private whiteCellBehavior!: WhiteCellBehaviorSystem;
  private contactSystem!: ContactSystem;
  private teamSystem!: TeamSystem;
  private macrophageSystem!: MacrophageSystem;
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
    this.whiteCellBehavior = new WhiteCellBehaviorSystem();
    this.contactSystem = new ContactSystem();
    this.teamSystem = new TeamSystem();
    this.macrophageSystem = new MacrophageSystem();

    // 게임: 호중구 무작위 배치. M3.3 검수용으로 hp 60~100% 랜덤 → 시작부터 다양한 크기.
    for (let i = 0; i < NEUTROPHIL_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      const hp = NEUTROPHIL.combat.maxHp * (0.6 + Math.random() * 0.4);
      this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, phase, hp));
    }

    // 게임: 세균 무작위 배치. 동일하게 hp 60~100% 랜덤.
    for (let i = 0; i < BACTERIA_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      const hp = BACTERIA_A.combat.maxHp * (0.6 + Math.random() * 0.4);
      this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase, hp);
    }

    // 게임: 커맨더 배치 (M5.1).
    for (let i = 0; i < COMMANDER_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      this.bacteriaBehavior.spawn(BACTERIA_COMMANDER, x, y, phase);
    }

    // 게임: 대식세포 배치 (M5.4a). 화면 바닥에서 좌우만 이동.
    const floorY = H - MACROPHAGE.shape.base;
    for (let i = 0; i < MACROPHAGE_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const phase = Math.random() * Math.PI * 2;
      this.macrophageSystem.add(new Macrophage(MACROPHAGE, this.cellRenderer, x, floorY, phase));
    }

    // Phaser: pointerdown = 마우스 클릭 + 터치 탭 둘 다 받음.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const t = this.time.now / 1000;
      this.shockwaveSystem.trySpawn(pointer.x, pointer.y, t);
    });

    this.add.text(20, 20, 'M5.4: 대식세포 + 호중구 재생산 (슈퍼 포함)', {
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

    const allCells = this.whiteCellBehavior.getAll();
    const allBacteria = this.bacteriaBehavior.getAll();
    const liveCells = this.whiteCellBehavior.getAlive();
    const liveBacteria = this.bacteriaBehavior.getAlive();

    // 게임: 1) 시스템 갱신 (자원/풀/팀)
    this.shockwaveSystem.update(t);
    this.nutrientSystem.update(t);
    // 게임: 팀 갱신 — 영입/탈퇴/해체 + 모드 결정 (방어/공격).
    //         behavior 호출 전이라 같은 프레임에 모드 전환 즉시 반영.
    this.teamSystem.update(allBacteria, allCells);

    // 게임: 2) 충돌 + 데미지 — 호중구↔세균 접촉 시 양쪽 hp 깎임 + combat 시각.
    //         호중구 사망 시 데미지 가한 세균 팀에 영양분 흡수 효과 보상.
    //         시체는 isContacting 에서 자동 제외.
    this.contactSystem.update(allCells, allBacteria, dt, t, this.teamSystem);

    // 게임: 3) 충격파 임펄스 — 시체는 ShockwaveSystem 내부에서 자동 skip.
    this.shockwaveSystem.applyToCells(allCells, t, dt);

    // 게임: 4) 같은 종족 분리력 — 시체는 겹쳐질 수 있어야 하므로 살아있는 것만.
    applySeparation(
      liveCells as unknown as import('../domain/separation').SeparableEntity[],
      SEPARATION_PADDING,
      SEPARATION_STRENGTH,
      dt,
    );
    applySeparation(
      liveBacteria as unknown as import('../domain/separation').SeparableEntity[],
      SEPARATION_PADDING,
      SEPARATION_STRENGTH,
      dt,
    );

    // 게임: 5) 자체 추진 lerp.
    //         WhiteCell: 살아있는 세균만 prey 후보 (시체 추적 X).
    //         Bacteria: 살아있는 호중구만 predator 후보 (시체 회피 X).
    this.whiteCellBehavior.update(dt, liveBacteria);
    this.bacteriaBehavior.update(t, dt, bounds, this.nutrientSystem, liveCells, this.teamSystem);

    // 게임: 6) 백혈구 위치/렌더 갱신 (살아있는 것 + 시체 모두 — 시체는 내부에서 낙하 처리)
    for (const cell of allCells) cell.update(t, dt, bounds);

    // 게임: 7) 대식세포 — 침전된 시체 흡수 + 점수 누적.
    const macrophageFloorY = bounds.height - MACROPHAGE.shape.base;
    this.macrophageSystem.update(macrophageFloorY, dt, allCells, allBacteria);

    // 게임: 8) 점수 100 도달 시 호중구 생산. 대식세포 위에서 등장.
    //         호중구 사체 점수 ≥40 이면 슈퍼 호중구.
    this.tryProduceWhiteCell();

    // 게임: 9) 흡수된 시체 정리 — 풀에서 제거 + 그래픽 핸들 destroy.
    this.cleanupAbsorbed();

    // 게임: 9) 시각화
    this.nutrientRenderer.draw(this.nutrientSystem.getAllSlots());
    this.shockwaveRenderer.draw(this.shockwaveSystem.getActiveWaves(), t);

    // 게임: HUD — 살아있는 것 카운트 + 평균 hp 비율 + 팀 정보 (검수용).
    const charges = this.shockwaveSystem.getCharges();
    const maxCharges = this.shockwaveSystem.getMaxCharges();
    const wAvg = liveCells.length > 0
      ? liveCells.reduce((s, c) => s + c.hpRatio(), 0) / liveCells.length
      : 0;
    const bAvg = liveBacteria.length > 0
      ? liveBacteria.reduce((s, b) => s + b.hpRatio(), 0) / liveBacteria.length
      : 0;
    const teams = this.teamSystem.getTeams();
    const teamInfo = teams.map((t) => {
      const max = t.commander.currentMaxTeamSize();
      const flag = t.mode === 'aggressive' ? '!' : '';
      return `[lvl${t.commander.getLevel()} ${t.members.length}/${max}${flag}]`;
    }).join(' ');
    const score = this.macrophageSystem.getTotalScore();
    const wScore = this.macrophageSystem.getWhiteCellScoreInPool();
    this.hudText.setText(
      `charges: ${charges}/${maxCharges}   live W/B: ${liveCells.length}/${liveBacteria.length}   hp avg: ${pct(wAvg)} / ${pct(bAvg)}   teams: ${teamInfo || '-'}   score: ${score}/100 (W:${wScore})`,
    );
  }

  // 게임: 흡수된 시체 정리. 매 프레임 update 끝에 호출.
  private cleanupAbsorbed(): void {
    this.whiteCellBehavior.removeAbsorbed();
    this.bacteriaBehavior.removeAbsorbed();
  }

  // 게임: 대식세포 점수 100 도달 시 호중구 생산.
  //   - 슈퍼 조건 만족(호중구 점수 ≥ 40): NEUTROPHIL_SUPER
  //   - 아니면: NEUTROPHIL
  //   - 위치: 첫 번째 대식세포 X 좌표 위, Y 50~120 사이 (화면 위쪽)
  //   - 한 프레임에 여러 번 발동 가능 (점수가 충분히 쌓였을 때 연속 생산)
  private tryProduceWhiteCell(): void {
    const macrophages = this.macrophageSystem.getAll();
    if (macrophages.length === 0) return;

    let result = this.macrophageSystem.consumeScoreForProduction();
    while (result !== null) {
      const m = macrophages[0];
      const x = m.x;
      const y = 50 + Math.random() * 70;
      const phase = Math.random() * Math.PI * 2;
      const dna = result.isSuper ? NEUTROPHIL_SUPER : NEUTROPHIL;
      this.whiteCellBehavior.add(new WhiteCell(dna, this.cellRenderer, x, y, phase));
      result = this.macrophageSystem.consumeScoreForProduction();
    }
  }
}
