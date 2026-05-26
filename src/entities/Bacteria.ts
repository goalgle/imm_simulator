// 세균 엔티티 — 일반(BACTERIA_A), 커맨더(BACTERIA_COMMANDER) 등.
// LivingCell 베이스를 상속하여 hp/combatResponse/시체 처리는 공통.
// 추가 책임: 영양분 흡수 카운터, 분열 애니메이션, 커맨더 상태(level/시야/지휘범위).

import type { DNA } from '../domain/dna';
import type { CellRenderer } from '../render/CellRenderer';
import { LivingCell, type Bounds } from './LivingCell';
import type { WhiteCell } from './WhiteCell';

export type MitosisState = {
  startTime: number;
  duration: number;
} | null;

const MITOSIS_DURATION = 0.5;
const MITOSIS_PEAK_SCALE = 1.4;

const ABSORB_RADIUS_BONUS = 5;
const MITOSIS_THRESHOLD = 3;

// 게임: 벽 탄성 반사 계수. 0=흡수(정지), 1=완전 탄성. 0.5 = 호중구와 동일.
//   이전엔 vx=0 단순 클램프 — drives 의 desired 가 벽 쪽이면 정지 + 분열 자식이 누적되어
//   세균이 벽에 박혀 군집 (특히 모바일 portrait 좁은 화면에서 빈발). 탄성 반사로 한 번 튕겨
//   안쪽으로 → 다음 frame drives 가 다시 벽 쪽으로 끌더라도 lerp 시간 차로 박힘 해소.
const BACTERIA_WALL_BOUNCE = 0.5;

export class Bacteria extends LivingCell {
  absorbCounter = 0;
  mitosis: MitosisState = null;
  pendingSpawn = false;
  // 게임: 커맨더 상태. 일반 세균은 변동 없음 (DNA.command.baseTeamSize=0).
  private level = 0;
  private totalAbsorbed = 0;
  currentVisionRange: number;
  currentCommandRange: number;
  // 게임: 바이러스 보유 세균 (페이즈 2 트리거). 분열 시 10% 확률 setInfected.
  //   호중구가 죽이면 BloodScene 가 그 호중구 안에서 페이즈 2 자동 진입.
  //   분열 안 함 (자식 색이 부모 색을 상속하면 시각 혼란 — 정책상 차단).
  isInfected = false;
  // 게임: 마지막으로 데미지를 가해 죽인 호중구 reference. infected 만 ContactSystem 이 기록.
  //   BloodScene 가 매 프레임 검사 → 호중구 살아있으면 페이즈 2 진입 후 null.
  killedByCell: WhiteCell | null = null;
  // 게임: 스테이지 killed 카운터 중복 방지 (Session 20). isDead 처음 도달 시 BacteriaBehaviorSystem 가
  //   stageKilled++ + 이 flag=true. 다음 프레임 같은 세균 isDead 재검사 시 무시.
  wasCountedAsKilled = false;

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

  // 게임: 바이러스 보유 표시. dna 인스턴스 색만 변형 — 다른 세균엔 영향 X.
  //   보라 톤 (h=270, s=60) 으로 식별. 한 번만 적용 (중복 호출 무시).
  setInfected(): void {
    if (this.isInfected) return;
    this.isInfected = true;
    this.dna.color.h = 270;
    this.dna.color.s = 60;
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
      //   infected 세균은 분열 X (자식이 부모 보라색 dna 를 상속하면 시각 혼란 회피).
      this.absorbCounter++;
      if (this.absorbCounter >= MITOSIS_THRESHOLD && this.mitosis === null && !this.isInfected) {
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
    // 게임: 벽 탄성 반사 — vx=0 강제하면 drives 가 벽 쪽이면 정체. 반사로 안쪽 push.
    if (this.x < r) { this.x = r; if (this.vx < 0) this.vx = -this.vx * BACTERIA_WALL_BOUNCE; }
    else if (this.x > bounds.width - r) { this.x = bounds.width - r; if (this.vx > 0) this.vx = -this.vx * BACTERIA_WALL_BOUNCE; }
    if (this.y < r) { this.y = r; if (this.vy < 0) this.vy = -this.vy * BACTERIA_WALL_BOUNCE; }
    else if (this.y > bounds.height - r) { this.y = bounds.height - r; if (this.vy > 0) this.vy = -this.vy * BACTERIA_WALL_BOUNCE; }

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
