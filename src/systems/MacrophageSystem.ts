// 대식세포 시스템 (M5.4a).
// 매 프레임:
//   1) 각 대식세포에 대해 가장 가까운 침전 시체 (X 좌표 기준) 찾기
//   2) 그쪽으로 X 방향으로 이동 (속도 = DNA.behavior.speed)
//   3) 흡수 거리 도달 시 시체 isAbsorbed=true + 점수 누적
//
// 점수 누적:
//   - 세균 시체: +10
//   - 호중구 시체: +20
//   - 100점 도달 시 호중구 생산 (M5.4b 에서 추가)
//   - 그 100점 안의 호중구 사체 점수 ≥ 40 → 슈퍼 호중구 (M5.4c)

import type { Macrophage } from '../entities/Macrophage';
import type { WhiteCell } from '../entities/WhiteCell';
import type { Bacteria } from '../entities/Bacteria';
import type { EntityRegistry } from '../domain/entityControl';
import { getPerkState } from '../domain/perks';

// 게임: 점수 정책.
const SCORE_BACTERIA_CORPSE = 10;
const SCORE_WHITECELL_CORPSE = 20;

// 게임: 흡수 거리 — 대식세포 base + 시체 base × MIN_SCALE 대략.
//        시체가 작아져서(MIN_SCALE=0.5) 닿기 어려우므로 여유 padding.
const ABSORB_PADDING = 8;

// 게임: cancer 호중구 충돌 정지 padding (Stage 12).
//   대식세포 base + cancer base + 이 padding 안에 들어오면 정지 + 천천히 분해.
//   cancer hp=0 도달 시 시체 → 다음 프레임 대식세포가 흡수 (기존 시체 흡수 시스템).
const CANCER_BLOCK_PADDING = 4;
// 게임: cancer 분해 DPS — 대식세포 공격력. 호중구 ×20 의 1/2 정도로 천천히.
//   maxHp 100 기준 약 10s 분해. 사용자 안 "공격력 최소 — 부딪치다 보면 결국 없앤다".
const CANCER_DECOMPOSE_DPS = 10;
// 게임: cancer 분해 시 시각 자극 (combat 채널) — 대식세포 접촉 중임을 cancer 가 빨강쪽으로 표시.
const CANCER_DECOMPOSE_STIMULUS = 2.0;

// 게임: 가장 가까운 시체가 흡수 거리에 들어왔을 때 멈춤. 너무 멀면 그쪽으로 이동.
//        |vx| 가 0 이 되도록 부드러운 감쇠는 단순화 — 즉시 set.

export class MacrophageSystem {
  private macrophages: Macrophage[] = [];
  // 게임: 흡수 점수 누적 카운터. 100 도달 시 호중구 생산 (M5.4b).
  private totalScore = 0;
  // 게임: 호중구 사체 점수 별도 추적. 100 도달 시 비율 판정용.
  private whiteCellScoreInPool = 0;
  // 게임: 누적 호중구 생산 횟수. consumeScoreForProduction 가 성공 (non-null) 반환할 때마다 ++.
  //   컷신 waitForMacrophageProductions step 이 baseline 과 차이로 검사.
  private productionCount = 0;

  // 게임: registry 는 옵션 (기존 호출자 호환). 있으면 frozen/speedMul 분기 적용.
  constructor(private readonly registry?: EntityRegistry) {}

  add(m: Macrophage): void {
    if (this.registry && !this.registry.get('macrophage').enabled) return;
    this.macrophages.push(m);
  }

  // 게임: 모든 대식세포 정리 (handle destroy + 풀 비움). 컷신 clear step 등에 사용.
  clearAll(): void {
    for (const m of this.macrophages) m.destroy();
    this.macrophages = [];
  }

  getAll(): readonly Macrophage[] {
    return this.macrophages;
  }

  getTotalScore(): number {
    return this.totalScore;
  }

  getWhiteCellScoreInPool(): number {
    return this.whiteCellScoreInPool;
  }

  // 게임: 누적 호중구 생산 횟수. 컷신 종료 조건 등에 사용.
  getProductionCount(): number {
    return this.productionCount;
  }

  // 게임: 매 프레임 호출. 시체 풀은 BloodScene 이 모아서 전달.
  //   t            : gameTime (Macrophage.manualUntil 만료 비교용 — Session 19)
  //   floorY       : 화면 바닥 Y (대식세포 Y 강제용)
  //   whiteCells   : 호중구 풀 (시체 포함)
  //   bacteria     : 세균 풀 (시체 포함)
  //   screenWidth  : 영역 분할용 화면 너비
  update(
    t: number,
    floorY: number,
    dt: number,
    whiteCells: readonly WhiteCell[],
    bacteria: readonly Bacteria[],
    screenWidth: number,
  ): void {
    // 게임: 동적 영역 분할 — N마리면 화면을 N등분. 현재 x 기준 정렬 후 좌→우 zone 할당.
    //   매 프레임 재계산. 점수 누적은 모든 대식세포가 totalScore 에 공유 → N마리면 청소 속도 N배.
    const N = this.macrophages.length;
    if (N > 0) {
      const sorted = [...this.macrophages].sort((a, b) => a.x - b.x);
      const zoneWidth = screenWidth / N;
      for (let i = 0; i < N; i++) {
        sorted[i].zoneMinX = i * zoneWidth;
        sorted[i].zoneMaxX = (i + 1) * zoneWidth;
      }
    }

    // 게임: frozen 시 vx=0 강제 + 추적/흡수 skip. speedMul 은 이동 속도에 곱.
    const ctrl = this.registry?.get('macrophage');
    if (ctrl?.frozen) {
      for (const m of this.macrophages) {
        m.vx = 0;
        m.update(performance.now() / 1000, dt, floorY);
        m.setVisible(ctrl.visible);
      }
      return;
    }
    const speedMul = ctrl?.speedMul ?? 1;
    for (const m of this.macrophages) {
      // 게임: 가장 가까운 침전 시체 찾기 (X 좌표 거리 기준 — Y 는 어차피 바닥).
      //   zone 밖 시체는 제외 — 자기 구역 안 시체만 노림.
      let nearest: { x: number; y: number; isWhite: boolean; entity: WhiteCell | Bacteria } | null = null;
      let bestDx = Infinity;

      for (const w of whiteCells) {
        if (!w.isSettled() || w.isAbsorbed) continue;
        if (w.x < m.zoneMinX || w.x > m.zoneMaxX) continue;
        const dx = Math.abs(w.x - m.x);
        if (dx < bestDx) {
          bestDx = dx;
          nearest = { x: w.x, y: w.y, isWhite: true, entity: w };
        }
      }
      for (const b of bacteria) {
        if (!b.isSettled() || b.isAbsorbed) continue;
        if (b.x < m.zoneMinX || b.x > m.zoneMaxX) continue;
        const dx = Math.abs(b.x - m.x);
        if (dx < bestDx) {
          bestDx = dx;
          nearest = { x: b.x, y: b.y, isWhite: false, entity: b };
        }
      }

      // 게임: 시체 흡수 처리 — 자동/수동 공통. nearest 가 흡수 거리 안이면 즉시 흡수.
      //   speed 에 registry.macrophage.speedMul 곱셈 (컷신 슬로우 등).
      const speed = m.dna.behavior.speed * speedMul;
      const absorbDist = m.dna.shape.base + ABSORB_PADDING;
      const absorbing = nearest !== null && bestDx <= absorbDist;
      if (absorbing) {
        nearest!.entity.isAbsorbed = true;
        if (nearest!.isWhite) {
          this.totalScore += SCORE_WHITECELL_CORPSE;
          this.whiteCellScoreInPool += SCORE_WHITECELL_CORPSE;
        } else {
          this.totalScore += SCORE_BACTERIA_CORPSE;
        }
      }

      // 게임: vx 결정 — 수동 모드 (t < manualUntil) 면 사용자 입력 방향, 아니면 nearest 추적.
      //   수동 모드 동안에도 흡수는 적용 (사용자가 시체 위로 가면 자연스럽게 처리).
      const manual = t < m.manualUntil;
      if (manual) {
        m.vx = m.manualDirX * speed;
      } else if (nearest === null || absorbing) {
        m.vx = 0;
      } else {
        m.vx = nearest!.x > m.x ? speed : -speed;
      }

      // 게임: cancer 호중구 충돌 (Stage 12) — 진로상 cancer 만나면 정지 + 천천히 분해.
      //   대식세포 진행 방향 (vx 부호) 으로 cancer 가 base 합 + padding 안에 있으면:
      //     1) vx=0 (장애물처럼 멈춤)
      //     2) 매 프레임 데미지 누적 → cancer hp 0 도달 시 시체 → 다음 프레임 흡수
      //   여러 cancer 가 진로상이면 가장 가까운 것 1개만 분해 (대식세포가 1개씩 처리).
      if (m.vx !== 0) {
        const blockDist = m.dna.shape.base + CANCER_BLOCK_PADDING;
        let blockTarget: WhiteCell | null = null;
        let blockTargetDist = Infinity;
        for (const w of whiteCells) {
          if (w.isDead() || w.isAbsorbed) continue;
          if (w.mutation !== 'cancer') continue;
          const dx = w.x - m.x;
          if ((m.vx > 0 && dx <= 0) || (m.vx < 0 && dx >= 0)) continue;
          const adx = Math.abs(dx);
          if (adx > blockDist + w.dna.shape.base) continue;
          if (adx < blockTargetDist) {
            blockTargetDist = adx;
            blockTarget = w;
          }
        }
        if (blockTarget !== null) {
          m.vx = 0;
          blockTarget.applyDamage(CANCER_DECOMPOSE_DPS * dt);
          blockTarget.applyCombatStimulus(CANCER_DECOMPOSE_STIMULUS * dt);
        }
      }

      m.update(performance.now() / 1000, dt, floorY);
    }

    // 게임: visible 일괄 토글.
    const visible = ctrl?.visible ?? true;
    for (const m of this.macrophages) m.setVisible(visible);
  }

  // 게임: 100점 도달 시 호중구 생산. 반환값으로 어떤 종류인지 결정.
  //   우선순위 (registry.<kind>.spawnProb 곱셈 적용):
  //     1. NK: 1/10 × registry.nk.spawnProb (디폴트 1 → 10%)
  //     2. SUPER (호중구 사체 점수 ≥ 40): × registry.neutrophilSuper.spawnProb (디폴트 1 → 100%)
  //     3. 일반 호중구: × registry.neutrophil.spawnProb
  //   세 가지 분기 모두 spawnProb=0 으로 막히면 null 반환 (점수 보존 — 다음 호출 시 재시도).
  consumeScoreForProduction(): { kind: 'normal' | 'super' | 'nk' } | null {
    if (this.totalScore < 100) return null;
    const perk = getPerkState();
    // 게임: NK 확률 = 기본 1/10 + perk.nkBonus. (registry spawnProb 곱셈 후)
    const nkProb = ((this.registry?.get('nk').spawnProb ?? 1)) * (0.1 + perk.nkBonus);
    // 게임: 슈퍼 자격 — 호중구 점수 ≥ 40, 또는 perk.superBonus 확률로 점수 무관 슈퍼.
    const superElig = this.whiteCellScoreInPool >= 40 || Math.random() < perk.superBonus;
    const superProb = this.registry?.get('neutrophilSuper').spawnProb ?? 1;
    const normalProb = this.registry?.get('neutrophil').spawnProb ?? 1;
    let kind: 'normal' | 'super' | 'nk' | null = null;
    if (Math.random() < nkProb) kind = 'nk';
    else if (superElig && Math.random() < superProb) kind = 'super';
    else if (Math.random() < normalProb) kind = 'normal';
    if (kind === null) return null;  // 모두 skip — 점수 보존
    this.totalScore -= 100;
    this.whiteCellScoreInPool = 0;
    this.productionCount++;
    return { kind };
  }
}
