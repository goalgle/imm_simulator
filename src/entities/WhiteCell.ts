// 백혈구 엔티티 — 호중구 / 슈퍼 호중구 등.
// LivingCell 베이스를 상속하여 hp/combatResponse/시체 처리는 공통.
// 추가 책임: 충격파 시각 자극(shockResponse), 마찰, 화면 경계 반사.

import type { DNA } from '../domain/dna';
import type { MutationKind } from '../domain/mutations';
import type { CellRenderer } from '../render/CellRenderer';
import { LivingCell, type Bounds } from './LivingCell';

// 게임: 마찰 계수 (1/sec). 충격파로 가속된 후 자연 감속.
const FRICTION = 1.5;

// 게임: 경계 반사 시 속도 보존율 (0=흡수, 1=완전 탄성).
const WALL_BOUNCE = 0.5;

// 게임: 충격파 시각 활성도(shockResponse) 회복 속도 (1/sec). 약 1초에 95% 회복.
const SHOCK_RECOVERY = 3.0;

// 게임: 약화 임계 — HP 비율 이 미만이면 동료 흡수 대상 / 자기는 동료에게 의지.
//   0.25 → 0.50 (Session 16) — fusion 발동 빈도 ↑ 위해 완화.
//   호중구가 50% HP 까지 깎이면 약한 호중구로 인식 → 강한 동료 추적 / 강한 동료가 흡수.
export const WEAK_HP_THRESHOLD = 0.50;

// 게임: fusion 애니메이션 지속 시간 (초). 약한 호중구가 강한 호중구로 빨려들어가는 시간.
const FUSION_ANIM_DURATION = 0.35;
// 게임: fusion 애니메이션 끝 시점의 잔여 스케일 비율 (1 - 이 값 만큼 축소).
const FUSION_SHRINK = 0.85;
// 게임: fusion 애니메이션 끝 시점의 잔여 알파 (1 - 이 값 만큼 페이드).
const FUSION_FADE = 0.7;

export class WhiteCell extends LivingCell {
  private shockResponse = 0;
  // 게임: 동료 흡수 누적 카운터. 2 도달 시 슈퍼 호중구로 변환 (NEUTROPHIL 만 적용).
  mergeCounter = 0;
  // 게임: 항체 발사 쿨다운 남은 시간 (초). B세포만 사용. ≤ 0 도달 시 발사 가능.
  fireCooldownRemaining = 0;
  // 게임: 호중구 레벨 (NEUTROPHIL 만 사용). T세포 commandRange 안에서 세균 죽이면 +1.
  //        5 도달 시 NK/BCELL/SUPER 중 무작위 진화 (BloodScene 처리).
  level = 0;
  // 게임: 적용된 변이 종류. null = 변이 없음. setDna(dna, kind) 로 갱신.
  //   시스템 분기 키 (Stage 11~15 예정): ContactSystem/Behavior/Macrophage 가 이 값 보고 분기.
  //   dna.kind 는 변이 후에도 'NEUTROPHIL' 그대로 (호중구 정체성 유지) — mutation 으로 변이 식별.
  mutation: MutationKind | null = null;
  // 게임: fusion 애니메이션 상태. processFusion 가 startFusion 호출 시 set.
  //   updateFusion 이 매 프레임 보간 → 완료 시 isAbsorbed=true 로 정리.
  private fusionTarget: WhiteCell | null = null;
  private fusionProgress = 0;
  private fusionStartX = 0;
  private fusionStartY = 0;

  constructor(
    dna: DNA,
    renderer: CellRenderer,
    x: number,
    y: number,
    phase = 0,
    initialHp?: number,
  ) {
    super(dna, renderer, x, y, phase, initialHp);
  }

  applyShockImpulse(amount: number): void {
    if (this.isDead()) return;
    this.shockResponse = Math.min(1, this.shockResponse + amount);
  }

  // 게임: 변이 라벨 갱신. setDna 와 짝으로 호출 (setDna 가 dna 만, setMutation 이 라벨만 책임).
  //   다중 변이 정책 (Session 17 기획): 새 변이가 기존을 덮어씀.
  setMutation(kind: MutationKind | null): void {
    this.mutation = kind;
  }

  // 게임: HP 가 임계 미만이면 약화 — 동료에게 흡수 대상.
  isWeak(): boolean {
    return !this.isDead() && this.hpRatio() < WEAK_HP_THRESHOLD;
  }

  // 게임: fusion 진행 중인지. processFusion 의 후보 필터에서 제외용.
  isFusing(): boolean {
    return this.fusionTarget !== null;
  }

  // 게임: fusion 시작 — 약한 호중구가 강한 호중구(target) 로 빨려들어감.
  //   이미 진행 중이면 무시. 시작 시점 위치 기록 → 매 프레임 보간 기준점.
  startFusion(target: WhiteCell): void {
    if (this.fusionTarget !== null) return;
    this.fusionTarget = target;
    this.fusionProgress = 0;
    this.fusionStartX = this.x;
    this.fusionStartY = this.y;
  }

  // 게임: fusion 진행 중이면 사망/시체/행동 처리 모두 무시. 순수 애니메이션.
  override update(t: number, dt: number, bounds: Bounds): void {
    if (this.fusionTarget !== null && !this.isAbsorbed) {
      this.updateFusion(t, dt);
      return;
    }
    super.update(t, dt, bounds);
  }

  // 게임: fusion 애니메이션 — ease-in (가속) 으로 위치 보간 + 축소 + 페이드.
  //   완료 시 isAbsorbed=true 로 cleanupAbsorbed 가 정리.
  //   target 이 도중에 isAbsorbed (예: 슈퍼 변환) 되어도 target.x/y 는 마지막 좌표 유지 → 안전.
  private updateFusion(t: number, dt: number): void {
    this.fusionProgress += dt / FUSION_ANIM_DURATION;
    const tt = Math.min(1, this.fusionProgress);
    const eased = tt * tt; // ease-in
    const target = this.fusionTarget!;

    this.x = this.fusionStartX + (target.x - this.fusionStartX) * eased;
    this.y = this.fusionStartY + (target.y - this.fusionStartY) * eased;

    // 게임: 폴리곤 정상 갱신 + scaleExtra 로 축소.
    this.applyAliveVisuals(t, dt, {
      shock: this.shockResponse,
      scaleExtra: 1 - eased * FUSION_SHRINK,
    });
    // 게임: alpha 페이드 — applyAliveVisuals 가 안 건드리므로 별도 set.
    this.handle.setAlpha(1 - eased * FUSION_FADE);

    if (tt >= 1) {
      this.isAbsorbed = true;
    }
  }

  protected override updateAlive(t: number, dt: number, bounds: Bounds): void {
    // 게임: 위치 적분
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 마찰
    const decay = Math.exp(-FRICTION * dt);
    this.vx *= decay;
    this.vy *= decay;

    // 게임: 경계 반사 (baseRadius 기준)
    const r = this.dna.shape.base;
    if (this.x < r) {
      this.x = r;
      if (this.vx < 0) this.vx = -this.vx * WALL_BOUNCE;
    } else if (this.x > bounds.width - r) {
      this.x = bounds.width - r;
      if (this.vx > 0) this.vx = -this.vx * WALL_BOUNCE;
    }
    if (this.y < r) {
      this.y = r;
      if (this.vy < 0) this.vy = -this.vy * WALL_BOUNCE;
    } else if (this.y > bounds.height - r) {
      this.y = bounds.height - r;
      if (this.vy > 0) this.vy = -this.vy * WALL_BOUNCE;
    }

    // 게임: 충격파 활성도 감쇠
    this.shockResponse *= Math.exp(-SHOCK_RECOVERY * dt);
    if (this.shockResponse < 0.001) this.shockResponse = 0;

    this.applyAliveVisuals(t, dt, { shock: this.shockResponse });
  }
}
