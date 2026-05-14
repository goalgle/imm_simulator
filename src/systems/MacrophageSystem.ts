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

  add(m: Macrophage): void {
    this.macrophages.push(m);
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

  // 게임: 매 프레임 호출. 시체 풀은 BloodScene 이 모아서 전달.
  //   t          : gameTime (Macrophage.manualUntil 만료 비교용 — Session 19)
  //   floorY     : 화면 바닥 Y (대식세포 Y 강제용)
  //   whiteCells : 호중구 풀 (시체 포함)
  //   bacteria   : 세균 풀 (시체 포함)
  update(
    t: number,
    floorY: number,
    dt: number,
    whiteCells: readonly WhiteCell[],
    bacteria: readonly Bacteria[],
  ): void {
    for (const m of this.macrophages) {
      // 게임: 가장 가까운 침전 시체 찾기 (X 좌표 거리 기준 — Y 는 어차피 바닥).
      let nearest: { x: number; y: number; isWhite: boolean; entity: WhiteCell | Bacteria } | null = null;
      let bestDx = Infinity;

      for (const w of whiteCells) {
        if (!w.isSettled() || w.isAbsorbed) continue;
        const dx = Math.abs(w.x - m.x);
        if (dx < bestDx) {
          bestDx = dx;
          nearest = { x: w.x, y: w.y, isWhite: true, entity: w };
        }
      }
      for (const b of bacteria) {
        if (!b.isSettled() || b.isAbsorbed) continue;
        const dx = Math.abs(b.x - m.x);
        if (dx < bestDx) {
          bestDx = dx;
          nearest = { x: b.x, y: b.y, isWhite: false, entity: b };
        }
      }

      // 게임: 시체 흡수 처리 — 자동/수동 공통. nearest 가 흡수 거리 안이면 즉시 흡수.
      const speed = m.dna.behavior.speed;
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
  }

  // 게임: 100점 도달 시 호중구 생산. 반환값으로 어떤 종류인지 결정.
  //   우선순위:
  //     1. 1/10 확률 → NK 세포 (암살자)
  //     2. 호중구 사체 점수 ≥ 40 → 슈퍼 호중구
  //     3. 그 외 → 일반 호중구
  //   매 호출 시 카운터 -100, 호중구 풀 0 리셋.
  consumeScoreForProduction(): { kind: 'normal' | 'super' | 'nk' } | null {
    if (this.totalScore < 100) return null;
    let kind: 'normal' | 'super' | 'nk';
    if (Math.random() < 0.1) {
      kind = 'nk';
    } else if (this.whiteCellScoreInPool >= 40) {
      kind = 'super';
    } else {
      kind = 'normal';
    }
    this.totalScore -= 100;
    this.whiteCellScoreInPool = 0;
    return { kind };
  }
}
