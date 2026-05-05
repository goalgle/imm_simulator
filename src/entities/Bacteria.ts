// 세균 엔티티 — 일반(BACTERIA_A), 커맨더(BACTERIA_COMMANDER) 등.
// LivingCell 베이스를 상속하여 hp/combatResponse/시체 처리는 공통.
// 추가 책임: 영양분 흡수 카운터, 분열 애니메이션, 커맨더 상태(level/시야/지휘범위).

import type { DNA } from '../domain/dna';
import type { CellRenderer } from '../render/CellRenderer';
import { LivingCell, type Bounds } from './LivingCell';

export type MitosisState = {
  startTime: number;
  duration: number;
} | null;

const MITOSIS_DURATION = 0.5;
const MITOSIS_PEAK_SCALE = 1.4;

const ABSORB_RADIUS_BONUS = 5;
const MITOSIS_THRESHOLD = 3;

export class Bacteria extends LivingCell {
  absorbCounter = 0;
  mitosis: MitosisState = null;
  pendingSpawn = false;
  // 게임: 커맨더 상태. 일반 세균은 변동 없음 (DNA.command.baseTeamSize=0).
  private level = 0;
  private totalAbsorbed = 0;
  currentVisionRange: number;
  currentCommandRange: number;

  constructor(
    dna: DNA,
    renderer: CellRenderer,
    x: number,
    y: number,
    phase = 0,
    initialHp?: number,
  ) {
    super(dna, renderer, x, y, phase, initialHp);
    this.currentVisionRange = dna.command.visionRange;
    this.currentCommandRange = dna.command.commandRange;
  }

  // 게임: baseTeamSize > 0 이면 지휘관 — 흡수/행동 분기 기준.
  isCommander(): boolean {
    return this.dna.command.baseTeamSize > 0;
  }

  getLevel(): number {
    return this.level;
  }

  // 게임: 현재 레벨 기반 최대 팀원 수. baseTeamSize + floor(level / teamSizeStep).
  currentMaxTeamSize(): number {
    const cmd = this.dna.command;
    if (cmd.baseTeamSize === 0 || cmd.teamSizeStep === 0) return 0;
    return cmd.baseTeamSize + Math.floor(this.level / cmd.teamSizeStep);
  }

  absorbRadius(): number {
    return this.dna.shape.base + ABSORB_RADIUS_BONUS;
  }

  // 게임: 영양분 흡수 (또는 호중구 처치 보상). 종족별 분기.
  registerAbsorb(t: number): void {
    if (this.isDead()) return;
    this.totalAbsorbed++;

    if (this.isCommander()) {
      // 게임: 커맨더 — 시야/지휘범위 확장 + 레벨업. 분열 X.
      const cmd = this.dna.command;
      this.currentVisionRange += cmd.visionGrowth;
      this.currentCommandRange += cmd.commandGrowth;
      if (cmd.levelUpAbsorbCount > 0) {
        this.level = Math.floor(this.totalAbsorbed / cmd.levelUpAbsorbCount);
      }
    } else {
      // 게임: 일반 세균 — 분열 카운터.
      this.absorbCounter++;
      if (this.absorbCounter >= MITOSIS_THRESHOLD && this.mitosis === null) {
        this.mitosis = { startTime: t, duration: MITOSIS_DURATION };
      }
    }
  }

  // 게임: 사망 시 분열 진행 중단 + pendingSpawn 취소.
  protected override onDeath(): void {
    this.mitosis = null;
    this.pendingSpawn = false;
  }

  protected override updateAlive(t: number, dt: number, bounds: Bounds): void {
    // 게임: 위치 적분 + 경계 클램핑 (세균은 벽에 튕기지 않고 정지).
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const r = this.dna.shape.base;
    if (this.x < r) { this.x = r; if (this.vx < 0) this.vx = 0; }
    else if (this.x > bounds.width - r) { this.x = bounds.width - r; if (this.vx > 0) this.vx = 0; }
    if (this.y < r) { this.y = r; if (this.vy < 0) this.vy = 0; }
    else if (this.y > bounds.height - r) { this.y = bounds.height - r; if (this.vy > 0) this.vy = 0; }

    // 게임: 분열 진행 중이면 시각 펄스 계산 + 완료 처리.
    let mitosisScale = 1.0;
    if (this.mitosis !== null) {
      const progress = (t - this.mitosis.startTime) / this.mitosis.duration;
      if (progress >= 1.0) {
        this.pendingSpawn = true;
        this.mitosis = null;
        this.absorbCounter = 0;
      } else {
        const bell = Math.sin(progress * Math.PI);
        mitosisScale = 1.0 + (MITOSIS_PEAK_SCALE - 1.0) * bell;
      }
    }

    this.applyAliveVisuals(t, dt, { scaleExtra: mitosisScale });
  }
}
