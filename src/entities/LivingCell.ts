// 살아있는 세포의 추상 베이스 — WhiteCell, Bacteria 의 공통 동작 집약.
//
// 공통 책임:
//   - 위치/속도 (vx, vy)
//   - HP (applyDamage, hpRatio, isDead)
//   - 시체 상태 (isSettled, isAbsorbed, updateAsCorpse: 중력 낙하 + 회색)
//   - 전투 시각 자극 (combatResponse, applyCombatStimulus, 회복 감쇠)
//   - 시각 통보 헬퍼 (applyAliveVisuals)
//
// 자식이 책임:
//   - updateAlive(t, dt, bounds) — 살아있을 때 행동/물리/시각
//   - 종족 고유 형질 (호중구의 shockResponse, 세균의 mitosis 등)
//   - onDeath() override — 사망 직후 정리 (예: 분열 중단)

import type { DNA, DnaKind } from '../domain/dna';
import { cloneDna } from '../domain/dna';
import type { CellRenderer, CellRenderHandle } from '../render/CellRenderer';

export type Bounds = {
  width: number;
  height: number;
};

// 게임: 모든 종 공통 — HP 비율 → 시각 스케일 매핑. 시체도 MIN_SCALE 유지.
export const MIN_SCALE = 0.5;

// 게임: 시체 낙하 가속도 (px/s²).
const GRAVITY = 80;
// 게임: 시체 옆 이동 감쇠 (1/sec). 빠르게 수직 낙하로 수렴.
const CORPSE_HORIZONTAL_DAMPING = 2.0;
// 게임: 전투 시각 자극(combatResponse) 회복 속도 (1/sec).
const COMBAT_RECOVERY = 4.0;

// 게임: 자식 클래스가 applyAliveVisuals 호출 시 옵션.
export type AliveVisualOptions = {
  // 게임: 충격파 등 추가 시각 자극 채널 (기본 0).
  shock?: number;
  // 게임: hpScale 외에 추가로 곱할 스케일 (예: 분열 펄스). 기본 1.
  scaleExtra?: number;
};

export abstract class LivingCell {
  protected handle: CellRenderHandle;
  vx = 0;
  vy = 0;
  protected combatResponse = 0;
  protected hp: number;
  // 게임: 대식세포가 흡수했음을 표시. BloodScene 이 매 프레임 끝에 청소.
  isAbsorbed = false;
  // 게임: 인스턴스 보유 DNA. 생성 시 클론으로 받아 cell 마다 독립.
  //        readonly 아님 — 변이 적용 시 setDna 로 교체 (Stage 6 예정).
  //        외부에서 직접 할당 X. dnaKind getter 로 종족 비교.
  public dna: DNA;

  constructor(
    initialDna: DNA,
    renderer: CellRenderer,
    public x: number,
    public y: number,
    phase = 0,
    initialHp?: number,
  ) {
    // 게임: 매 cell 이 자기 DNA 인스턴스 보유 — preset reference 공유 X.
    //        변이가 다른 cell 로 새지 않도록 격리.
    this.dna = cloneDna(initialDna);
    this.handle = renderer.create(this.dna, x, y);
    this.handle.setPhase(phase);
    this.hp = initialHp ?? this.dna.combat.maxHp;
  }

  // 게임: DNA 정체성 라벨 — reference 비교 (`cell.dna === NEUTROPHIL`) 대체용.
  //        변이 후에도 보존됨 (dna.kind 는 cloneDna/mutation 통과 시 유지).
  get dnaKind(): DnaKind {
    return this.dna.kind;
  }

  // 게임: DNA 교체 — 변이 적용 시 호출. handle 도 함께 갱신해 색/모양/속도가 즉시 반영됨.
  //   currentHp 는 그대로 유지 (변이 6종이 maxHp 를 안 건드림 — 관계없음).
  //   호출 후 행동 시스템이 매 프레임 dna 다시 읽으니 drives/speed/turnRate 자동 반영.
  //
  //   ⚠️ "변이 메커니즘" (정지/낙하/분열/scale 점감/폭발/마비 timer 등) 은 dna 만으로
  //   표현 불가 — 자식 클래스(WhiteCell)의 mutation 필드 + 시스템 분기로 처리. 자식에서
  //   override 하여 setMutation 같이 받게 하기를 권장 (Stage 11~15 진행 시).
  setDna(dna: DNA): void {
    this.dna = dna;
    this.handle.setDna(dna);
  }

  // 게임: ContactSystem 이 매 프레임 접촉 중일 때 호출.
  applyCombatStimulus(amount: number): void {
    if (this.isDead()) return;
    this.combatResponse = Math.min(1, this.combatResponse + amount);
  }

  applyDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }

  // 게임: HP 회복. maxHp 까지 캡. 죽은 상태에선 회복 안 됨 (부활 막음).
  heal(amount: number): void {
    if (this.isDead()) return;
    this.hp = Math.min(this.dna.combat.maxHp, this.hp + amount);
  }

  hpRatio(): number {
    const max = this.dna.combat.maxHp;
    return max > 0 ? this.hp / max : 0;
  }

  isDead(): boolean {
    return this.hp <= 0;
  }

  // 게임: 침전된 시체 = 죽었고 + 화면 바닥에서 정지. 대식세포 흡수 대상.
  isSettled(): boolean {
    return this.isDead() && this.vy === 0 && this.vx === 0;
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.handle.setPosition(x, y);
  }

  // 게임: 화면 표시 토글 — 컷신 / 디버그가 등장 가시화 제어 시 사용.
  //   행동/충돌과는 별개 (visible=false 라도 시뮬레이션은 진행).
  setVisible(visible: boolean): void {
    this.handle.setVisible(visible);
  }

  destroy(): void {
    this.handle.destroy();
  }

  // 게임: 매 프레임 호출. 사망 여부에 따라 분기.
  update(t: number, dt: number, bounds: Bounds): void {
    if (this.isDead()) {
      this.updateAsCorpse(t, dt, bounds);
    } else {
      this.updateAlive(t, dt, bounds);
    }
  }

  // 자식이 구현 — 살아있을 때 행동/물리/시각.
  protected abstract updateAlive(t: number, dt: number, bounds: Bounds): void;

  // 자식 hook — 사망으로 전환되는 시점에 정리할 일이 있을 때 override.
  protected onDeath(): void {}

  // 게임: 시체 처리 — 행동/충돌 모두 정지, 중력만 작용. 화면 바닥(큰 Y)에 침전.
  protected updateAsCorpse(t: number, dt: number, bounds: Bounds): void {
    this.onDeath();

    // 게임: 옆 이동 감쇠 → 거의 수직 낙하
    this.vx *= Math.exp(-CORPSE_HORIZONTAL_DAMPING * dt);
    // 게임: 중력
    this.vy += GRAVITY * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 게임: 바닥 도달 시 침전 (vy=0, vx=0).
    const floor = bounds.height - this.dna.shape.base * MIN_SCALE;
    if (this.y >= floor) {
      this.y = floor;
      this.vy = 0;
      this.vx = 0;
    }

    // 게임: 시체 시각 — life=0 → 회색, 떨림 정지. 크기는 MIN_SCALE 유지.
    this.handle.setScale(MIN_SCALE);
    this.handle.setVisualState({ shock: 0, combat: 0, life: 0 });
    this.handle.setPosition(this.x, this.y);
    this.handle.update(t);
  }

  // 게임: 자식이 살아있을 때 update 끝에 호출 — combatResponse 감쇠 + 시각 통보.
  //   options.shock: 충격파 활성도 (호중구 등)
  //   options.scaleExtra: hpScale 곱셈 외 추가 배율 (분열 펄스 등)
  protected applyAliveVisuals(t: number, dt: number, options: AliveVisualOptions = {}): void {
    this.combatResponse *= Math.exp(-COMBAT_RECOVERY * dt);
    if (this.combatResponse < 0.001) this.combatResponse = 0;

    const hpScale = MIN_SCALE + (1 - MIN_SCALE) * this.hpRatio();
    const finalScale = hpScale * (options.scaleExtra ?? 1);
    this.handle.setScale(finalScale);
    this.handle.setVisualState({
      shock: options.shock ?? 0,
      combat: this.combatResponse,
      life: 1,
    });
    this.handle.setPosition(this.x, this.y);
    this.handle.update(t);
  }
}
