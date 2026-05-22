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

// 게임: cancer 변이 — 정지 + 바닥 낙하 (Session 17 정정: 분열은 옵션으로 보존, 현재 비활성).
//   GRAVITY/DAMPING 은 시체 처리와 동일 — 형식상 "살아있는 정지 덩어리" 가 바닥으로.
const CANCER_GRAVITY = 80;
const CANCER_HORIZONTAL_DAMPING = 2.0;
// 게임: cancer 분열 활성화 토글. true 면 CANCER_DIVIDE_DELAY 후 자식 1마리 spawn.
//   현재 false — 분열 X. 게임 디자인 검토 후 활성화 가능 (코드는 보존).
const CANCER_DIVIDE_ENABLED = false;
// 게임: 분열 지연 (초). cancer 변이 시점부터 이만큼 후 자식 spawn. ENABLED=false 면 미사용.
const CANCER_DIVIDE_DELAY = 6;
// 게임: 분열 자식 임펄스 (px/s). 부모 기준 좌 또는 우. ENABLED=false 면 미사용.
export const CANCER_DIVIDE_IMPULSE = 80;

// 게임: corruption 변이 — scale 점감 시간 (초). 시작 시점 1 → 0 까지 선형 보간.
//   소멸 직전 시각: applyAliveVisuals 의 scaleExtra 로 폴리곤 축소. dna 의 격렬 떨림은 그대로.
const CORRUPTION_DURATION = 5;

// 게임: hyperactive 변이 — scale 점증 시간 (초). 1 → HYPERACTIVE_SCALE_END.
//   임계 도달 시 폭발 트리거 (반경 데미지는 BloodScene). 본인 isAbsorbed=true 로 소멸.
const HYPERACTIVE_DURATION = 4;
const HYPERACTIVE_SCALE_END = 2.5;

// 게임: paralysis 변이 — 자기 주기 (cycle 마다 duration 만큼 마비) + 외부 전파 (인접 호중구).
//   cycle 시작 시각 paralysisStartTime 기준 ((t - start) % CYCLE) < DURATION 이면 active.
//   외부 전파는 paralyzedUntil 직접 set (변이 호중구가 BloodScene 의 propagation 메서드에서).
const PARALYSIS_CYCLE = 3;
const PARALYSIS_DURATION = 0.5;

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
  // 게임: cancer 분열 예약 시각 (gameTime 기준). null = 분열 안 함.
  //   부모는 beginCancerDivide(t) 로 t+6s 설정. 자손은 setMutation('cancer') 만 호출 (cancerSpawnTime 그대로 null).
  cancerSpawnTime: number | null = null;
  // 게임: cancer 분열 처리 요청 플래그. WhiteCellBehaviorSystem 가 매 프레임 처리 후 false.
  pendingCancerSpawn = false;
  // 게임: corruption 모드 시작 시각 (gameTime 기준). null = 점감 미시작.
  //   beginCorruption(t) 로 set. updateAlive 가 매 프레임 elapsed 계산 → scaleExtra 점감.
  corruptionStartTime: number | null = null;
  // 게임: corruption 소멸 트리거. scale 0 도달 시 true → BloodScene.checkCorruptionTrigger 가 처리 후 false.
  //   핸들러는 페이즈 2 자동 진입 (다른 호중구 host) 을 시도하고, isAbsorbed=true 로 풀에서 제거.
  pendingCorruptionFinale = false;
  // 게임: hyperactive 모드 시작 시각. null = 점증 미시작.
  //   beginHyperactive(t) 로 set. updateAlive 가 매 프레임 scaleExtra 점증 → 4s 도달 시 폭발 트리거.
  hyperactiveStartTime: number | null = null;
  // 게임: hyperactive 폭발 트리거. scale 최대 도달 시 true → BloodScene.checkHyperactiveTrigger 가 처리.
  //   처리 = 반경 200px 내 호중구/세균 즉사 + 본인 isAbsorbed=true.
  pendingHyperactiveExplosion = false;
  // 게임: paralysis 변이 cycle 시작 시각. null = 사이클 미시작 (변이 호중구 본인만 set).
  //   beginParalysis(t) 로 set. isParalyzed(t) 가 cycle 안 active 여부 계산.
  paralysisStartTime: number | null = null;
  // 게임: 외부 전파된 마비 만료 시각 (gameTime). 0 또는 < gameTime = 비활성.
  //   변이 호중구가 매 프레임 인접 호중구 paralyzedUntil 갱신 (1단계 전파만).
  paralyzedUntil = 0;
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
    // 게임: 백혈구는 전투 중에도 색이 변하지 않음. combat 채널의 채도/떨림 효과는 유지,
    //   hue lerp 만 비활성. NEUTROPHIL/SUPER/NK_CELL/BCELL/TCELL 모두 WhiteCell 인스턴스라 일괄 적용.
    this.combatHueScale = 0;
  }

  applyShockImpulse(amount: number): void {
    if (this.isDead()) return;
    this.shockResponse = Math.min(1, this.shockResponse + amount);
  }

  // 게임: 변이 라벨 갱신. setDna 와 짝으로 호출 (setDna 가 dna 만, setMutation 이 라벨만 책임).
  //   다중 변이 정책 (Session 17 기획): 새 변이가 기존을 덮어씀.
  //   변이 적용 시 (kind !== null) HP 풀 회복 — 변이 트리거가 보통 전투 직후라 그대로 두면 즉사.
  setMutation(kind: MutationKind | null): void {
    this.mutation = kind;
    if (kind !== null) this.heal(this.dna.combat.maxHp);
  }

  // 게임: cancer 분열 timer 시작. 부모만 호출 — 자식은 호출 X (자손은 분열 1번도 안 함).
  //   호출자가 현재 t (gameTime) 전달. setMutation('cancer') 후 즉시 호출 권장.
  //   CANCER_DIVIDE_ENABLED=false 면 noop — 분열 비활성 (Session 17 정정).
  beginCancerDivide(t: number): void {
    if (this.mutation !== 'cancer') return;
    if (!CANCER_DIVIDE_ENABLED) return;
    this.cancerSpawnTime = t + CANCER_DIVIDE_DELAY;
  }

  // 게임: corruption scale 점감 시작. setMutation('corruption') 후 즉시 호출 권장.
  //   t = 현재 gameTime. updateAlive 안에서 elapsed = t - corruptionStartTime 으로 점감.
  beginCorruption(t: number): void {
    if (this.mutation !== 'corruption') return;
    this.corruptionStartTime = t;
  }

  // 게임: hyperactive scale 점증 시작. setMutation('hyperactive') 후 즉시 호출.
  beginHyperactive(t: number): void {
    if (this.mutation !== 'hyperactive') return;
    this.hyperactiveStartTime = t;
  }

  // 게임: paralysis cycle 시작. setMutation('paralysis') 후 즉시 호출.
  beginParalysis(t: number): void {
    if (this.mutation !== 'paralysis') return;
    this.paralysisStartTime = t;
  }

  // 게임: 현재 마비 상태 — 변이 호중구 자기 cycle 또는 외부 전파 둘 다 검사.
  //   cycle active: 사이클 시작 후 ((t - start) % CYCLE) < DURATION 인 구간.
  //   external active: paralyzedUntil > t.
  isParalyzed(t: number): boolean {
    if (this.paralyzedUntil > t) return true;
    if (this.paralysisStartTime === null) return false;
    const phase = (t - this.paralysisStartTime) % PARALYSIS_CYCLE;
    return phase < PARALYSIS_DURATION;
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
  //   살아있는 cancer 호중구는 행동 정지 + 낙하 + 분열 timer (시체와 비슷하지만 살아있음).
  override update(t: number, dt: number, bounds: Bounds): void {
    if (this.fusionTarget !== null && !this.isAbsorbed) {
      this.updateFusion(t, dt);
      return;
    }
    if (!this.isDead() && this.mutation === 'cancer') {
      this.updateAsCancer(t, dt, bounds);
      return;
    }
    super.update(t, dt, bounds);
  }

  // 게임: cancer 모드 — 행동 정지, 즉시 바닥 낙하, 분열 timer 도달 시 spawn 요청.
  //   시체(updateAsCorpse) 와 형태상 유사하나 살아있음 (mutation 색 유지, applyAliveVisuals 호출).
  //   대식세포 충돌 정지는 MacrophageSystem 분기에서 처리.
  private updateAsCancer(t: number, dt: number, bounds: Bounds): void {
    // 게임: 옆 이동 감쇠 + 중력.
    this.vx *= Math.exp(-CANCER_HORIZONTAL_DAMPING * dt);
    this.vy += CANCER_GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 바닥 도달 — vy/vx 정지. 시체와 비슷.
    const floor = bounds.height - this.dna.shape.base * 0.5;
    if (this.y >= floor) {
      this.y = floor;
      this.vy = 0;
      if (Math.abs(this.vx) < 1) this.vx = 0;
    }

    // 게임: 분열 timer 도달 — 1번만 신호 (cancerSpawnTime null 처리).
    if (this.cancerSpawnTime !== null && t >= this.cancerSpawnTime) {
      this.pendingCancerSpawn = true;
      this.cancerSpawnTime = null;
    }

    // 게임: 시각 — 살아있는 호중구 (mutation 색 자동 반영). shock 채널은 정지 상태에 가깝지만 자극 받으면 표시.
    this.applyAliveVisuals(t, dt, { shock: this.shockResponse });
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
    // 게임: paralysis 활성 시 즉시 정지 — 위치 적분 X, vx/vy 0 강제.
    //   변이 호중구 본인 cycle 또는 외부 전파 둘 다 동일 처리.
    if (this.isParalyzed(t)) {
      this.vx = 0;
      this.vy = 0;
      this.shockResponse *= Math.exp(-SHOCK_RECOVERY * dt);
      if (this.shockResponse < 0.001) this.shockResponse = 0;
      this.applyAliveVisuals(t, dt, { shock: this.shockResponse });
      return;
    }
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

    // 게임: corruption 변이 — 매 프레임 scale 점감 (5s 동안 1 → 0). 행동/물리는 정상.
    //   tt >= 1 도달 시 finale 신호 + 풀 정리. 페이즈 2 자동 진입은 BloodScene 가 처리.
    let scaleExtra = 1;
    if (this.mutation === 'corruption' && this.corruptionStartTime !== null) {
      const elapsed = t - this.corruptionStartTime;
      const tt = Math.min(1, elapsed / CORRUPTION_DURATION);
      scaleExtra = 1 - tt;
      if (tt >= 1) {
        this.pendingCorruptionFinale = true;
        this.isAbsorbed = true;
      }
    }
    // 게임: hyperactive 변이 — 매 프레임 scale 점증 (4s 동안 1 → 2.5). 임계 도달 시 폭발 트리거.
    //   본인 isAbsorbed=true 즉시 (cleanupAbsorbed 가 정리). 폭발 영역 처리는 BloodScene.
    if (this.mutation === 'hyperactive' && this.hyperactiveStartTime !== null) {
      const elapsed = t - this.hyperactiveStartTime;
      const tt = Math.min(1, elapsed / HYPERACTIVE_DURATION);
      scaleExtra = 1 + tt * (HYPERACTIVE_SCALE_END - 1);
      if (tt >= 1) {
        this.pendingHyperactiveExplosion = true;
        this.isAbsorbed = true;
      }
    }

    this.applyAliveVisuals(t, dt, { shock: this.shockResponse, scaleExtra });
  }
}
