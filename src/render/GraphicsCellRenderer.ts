// CellRenderer 구현체 — Phaser.GameObjects.Graphics + fillPoints 기반.
// M0 측정 결과(시스템 구현 기획서 §1.2)에 따른 채택.
// 핵심: 매 프레임 generatePolygon → graphics.clear → 스타일별 layered fill.
//
// M3.4 부터 시각 채널 3개 합성:
//   - shock  : 채도 ↑ + 명도 ↓ + ampBoost ↑   (자기 색이 진해짐)
//   - combat : hue 를 빨강(0°) 쪽으로 lerp + ampBoost ↑   (다른 색이 됨)
//   - life   : 0 일 때 채도 0 (회색) + ampBoost ×0 (떨림 정지)
//
// 입체감 스타일 3종 (RENDERER_TYPE 으로 선택):
//   A — 매끈한 구체 음영 (의학 일러스트 톤)
//       Rim(어두운 외곽) → Body → Highlight(축소 polygon) → Specular(흰 점)
//   B — 발광/젖은 느낌 (네온/생체)
//       Halo(scale>1, 밝은 외곽 번짐) → Body(채도↑) → InnerGlow(밝은 중앙) → Specular(큼)
//   C — 만화풍 두꺼운 외곽선 + 평면 톤
//       Body(flat) → CellShade(작은 polygon, flat 밝은 톤) → Outline(strokePoints, 두꺼운 진한 선)
// vertex 평가는 1회. 추가 비용은 fill 호출 ×3~4 + 점 곱셈.

import Phaser from 'phaser';
import type { DNA } from '../domain/dna';
import { hslToRgbInt } from '../domain/color';
import { generatePolygon, type Point } from '../domain/shapeFunction';
import type { CellRenderer, CellRenderHandle, VisualState } from './CellRenderer';

const VERTEX_COUNT = 32;

// 게임: 입체감 스타일 선택. 컴파일 타임 상수 — 변경 후 빌드 필요.
//   'A' 매끈한 구체 음영 (현재 기본)
//   'B' 발광/젖은 (네온·생체)
//   'C' 만화풍 (두꺼운 외곽선 + 평면 톤)
type RendererStyle = 'A' | 'B' | 'C';
const RENDERER_TYPE: RendererStyle = 'B';

// 게임: 충격파 활성도 1 일 때의 색/형태 변환량.
const SHOCK_S_BOOST = 15;
const SHOCK_L_DROP = 25;
const SHOCK_AMP_BOOST = 0.5;

// 게임: 전투 활성도 1 일 때. shock 와 다른 채널이라 합성 가능.
//   combat 은 hue 를 빨강 쪽으로 lerp 시켜 "다른 색"으로 보이게 함.
const COMBAT_TARGET_HUE = 0;       // 빨강
const COMBAT_HUE_PULL = 0.6;       // 활성도 1 일 때 base hue → COMBAT_TARGET_HUE 까지 60% lerp
const COMBAT_S_BOOST = 20;         // 빨강쪽이라도 채도 살짝 ↑
const COMBAT_AMP_BOOST = 0.4;      // shock 와 별개 ampBoost 추가

// 게임: 죽으면 색 잃음. life=0 → 채도 0. (명도는 유지하여 "회색 시체" 시각).
//        형태 떨림도 0 → 정적 시체.

// === TYPE_A 상수 — 매끈한 구체 음영 (의학 일러스트 톤) ============================
//   RIM_L_DROP        — rim 색의 명도 감소량 (클수록 외곽이 어두워짐)
//   BODY_SCALE        — body polygon 축소 비율 (작을수록 rim 노출 ↑)
//   HIGHLIGHT_SCALE   — 하이라이트 polygon 축소 비율 (body 보다 작아야 안쪽으로 보임)
//   HIGHLIGHT_OFFSET  — 좌상단 광원 오프셋 (base 기준 비율). 음수가 좌/상.
//   HIGHLIGHT_L_BOOST — 하이라이트 색의 명도 증가량
//   HIGHLIGHT_S_DROP  — 하이라이트 색의 채도 감소량 (밝아질수록 흰색에 가까워야 자연스러움)
//   HIGHLIGHT_ALPHA   — 하이라이트 알파 (낮을수록 부드럽게 섞임)
//   SPECULAR_RADIUS   — 스펙ュ라 점 반지름 (base 기준 비율). 0 이면 끔.
//   SPECULAR_ALPHA    — 스펙ュ라 알파.
const TYPE_A_RIM_L_DROP = 28;
const TYPE_A_BODY_SCALE = 0.88;
const TYPE_A_HIGHLIGHT_SCALE = 0.55;
const TYPE_A_HIGHLIGHT_OFFSET = -0.1;
const TYPE_A_HIGHLIGHT_L_BOOST = 28;
const TYPE_A_HIGHLIGHT_S_DROP = 20;
const TYPE_A_HIGHLIGHT_ALPHA = 0.5;
const TYPE_A_SPECULAR_RADIUS = 0.12;
const TYPE_A_SPECULAR_ALPHA = 0.7;

// === TYPE_B 상수 — 발광/젖은 (네온·생체) =========================================
//   HALO_*       — body 보다 큰 polygon 을 밝은 색 + 알파로 깔아 외곽 번짐 효과
//   BODY_S_BOOST — 본체 채도 가산 (네온 톤은 본체도 채도가 높아야 함)
//   INNER_*      — 안쪽 밝은 중심부. TYPE_A 의 highlight 보다 더 밝고 짙은 알파.
//   SPECULAR_*   — 점이 더 커지고 더 진함.
const TYPE_B_HALO_SCALE = 1.10;
const TYPE_B_HALO_L_BOOST = 18;
const TYPE_B_HALO_S_BOOST = 15;
const TYPE_B_HALO_ALPHA = 0.40;
const TYPE_B_BODY_SCALE = 0.95;
const TYPE_B_BODY_S_BOOST = 15;
const TYPE_B_INNER_SCALE = 0.60;
const TYPE_B_INNER_OFFSET = -0.08;
const TYPE_B_INNER_L_BOOST = 35;
const TYPE_B_INNER_S_DROP = 10;
const TYPE_B_INNER_ALPHA = 0.65;
const TYPE_B_SPECULAR_RADIUS = 0.18;
const TYPE_B_SPECULAR_ALPHA = 0.85;

// === TYPE_C 상수 — 만화풍 (두꺼운 외곽선 + 평면 톤) ===============================
//   OUTLINE_WIDTH_RATIO — 외곽선 두께 (base 비율). 큰 세포는 굵게, 작은 세포는 얇게.
//   OUTLINE_WIDTH_MIN   — 최소 두께 (px) — 너무 작아 안 보이는 경우 보정.
//   OUTLINE_L_DROP      — 외곽선 색의 명도 감소량 (잉크처럼 어둡게)
//   OUTLINE_S_DROP      — 외곽선 색의 채도 감소량
//   CELLSHADE_SCALE     — 셀쉐이드 polygon 축소 비율
//   CELLSHADE_OFFSET    — 좌상단 오프셋 (TYPE_A 와 같은 방향)
//   CELLSHADE_L_BOOST   — 셀쉐이드 색의 명도 가산 (단계 명확하게)
//   alpha 는 모두 1.0 — flat 톤이 핵심.
const TYPE_C_OUTLINE_WIDTH_RATIO = 0.10;
const TYPE_C_OUTLINE_WIDTH_MIN = 2;
const TYPE_C_OUTLINE_L_DROP = 60;
const TYPE_C_OUTLINE_S_DROP = 30;
const TYPE_C_CELLSHADE_SCALE = 0.55;
const TYPE_C_CELLSHADE_OFFSET = -0.18;
const TYPE_C_CELLSHADE_L_BOOST = 18;

// === 영웅급 PostFX Glow (모든 RENDERER_TYPE 공통) =================================
// 게임: 영웅급(커맨더/T세포/슈퍼 호중구) PostFX Glow 파라미터.
//   PostFX 는 인스턴스당 렌더 타깃이 추가되어 batch 가 깨짐 — 다수 적용 시 성능 영향.
//   현재 게임 디자인상 영웅급은 소수라 OK.
//   color 는 각 DNA hue 기반으로 파생 → 자기 색이 발산되는 느낌.
const HERO_GLOW_OUTER = 4;       // 외곽 발광 강도 (기본 4)
const HERO_GLOW_INNER = 0;       // 내부 발광 강도 (0 = 안쪽으로 안 번짐)
const HERO_GLOW_QUALITY = 0.1;   // 0~1, 낮을수록 빠름/거침
const HERO_GLOW_DISTANCE = 14;   // 발광 반경 (px)
const HERO_GLOW_S_BOOST = 10;    // glow 색의 채도 가산
const HERO_GLOW_L_BOOST = 20;    // glow 색의 명도 가산 (밝아져야 발광 느낌)

class GraphicsHandle implements CellRenderHandle {
  private gfx: Phaser.GameObjects.Graphics;
  private dna: DNA;
  private phase = 0;
  private visual: VisualState = { shock: 0, combat: 0, life: 1 };
  private buffer: Point[];
  // 게임: 보조 buffer 두 개. 매 프레임 buffer 를 스케일/오프셋해서 갱신.
  //        스타일별로 의미가 다름 (A: body/highlight, B: halo→body 재사용/inner, C: cellshade).
  private bufferA: Point[];
  private bufferB: Point[];

  constructor(scene: Phaser.Scene, dna: DNA, x: number, y: number) {
    this.gfx = scene.add.graphics({ x, y });
    this.dna = dna;
    this.buffer = new Array(VERTEX_COUNT);
    this.bufferA = new Array(VERTEX_COUNT);
    this.bufferB = new Array(VERTEX_COUNT);
    for (let i = 0; i < VERTEX_COUNT; i++) {
      this.buffer[i] = { x: 0, y: 0 };
      this.bufferA[i] = { x: 0, y: 0 };
      this.bufferB[i] = { x: 0, y: 0 };
    }

    // 게임: 영웅급 DNA 면 Glow PostFX 적용. 평범한 호중구/일반 세균엔 안 붙음.
    if (isHeroDna(dna)) {
      const color = heroGlowColor(dna);
      this.gfx.postFX.addGlow(
        color,
        HERO_GLOW_OUTER,
        HERO_GLOW_INNER,
        false,
        HERO_GLOW_QUALITY,
        HERO_GLOW_DISTANCE,
      );
    }
  }

  setPosition(x: number, y: number): void {
    this.gfx.setPosition(x, y);
  }

  setPhase(phase: number): void {
    this.phase = phase;
  }

  setScale(scaleX: number, scaleY?: number): void {
    this.gfx.setScale(scaleX, scaleY ?? scaleX);
  }

  setAlpha(alpha: number): void {
    this.gfx.setAlpha(alpha);
  }

  setVisualState(state: VisualState): void {
    this.visual.shock = clamp01(state.shock);
    this.visual.combat = clamp01(state.combat);
    this.visual.life = clamp01(state.life);
  }

  // 게임: DNA 교체 — reference 만 갈아끼움. update() 가 매 프레임 this.dna 동적 참조하므로
  //   다음 프레임부터 새 색/shape 로 그려짐. PostFX(영웅 glow) 는 생성자 1회 적용이라 갱신 X.
  //   현재 변이 6종은 호중구→호중구 (영웅 변환 없음) 이라 무관.
  setDna(dna: DNA): void {
    this.dna = dna;
  }

  update(t: number): void {
    const c = this.dna.color;
    const { shock, combat, life } = this.visual;

    // 게임: hue — 평소 base, 전투 활성도에 따라 빨강(0°) 쪽으로 lerp.
    //        wrap-around 고려 안 함 — 빨강은 0° 라 단방향 lerp 으로 충분.
    const h = c.h + (COMBAT_TARGET_HUE - c.h) * (combat * COMBAT_HUE_PULL);

    // 게임: 채도 — base + shock + combat 부스트, 그러나 life 곱 (죽으면 0).
    const sRaw = c.s + SHOCK_S_BOOST * shock + COMBAT_S_BOOST * combat;
    const s = clamp01x100(sRaw * life);

    // 게임: 명도 — shock 만 어둡게. combat/life 는 명도 영향 X (회색 시체는 채도 0 으로 충분).
    const l = clamp01x100(c.l - SHOCK_L_DROP * shock);

    // 게임: 진폭 — 평소 1, 자극으로 ↑, 죽으면 0 (정적 시체).
    const ampBoost = (1 + SHOCK_AMP_BOOST * shock + COMBAT_AMP_BOOST * combat) * life;

    generatePolygon(this.dna, t, VERTEX_COUNT, this.phase, ampBoost, this.buffer);

    const base = this.dna.shape.base;
    this.gfx.clear();

    switch (RENDERER_TYPE) {
      case 'A': this.drawTypeA(base, h, s, l, life); break;
      case 'B': this.drawTypeB(base, h, s, l, life); break;
      case 'C': this.drawTypeC(base, h, s, l); break;
    }
  }

  // 게임: TYPE_A — 매끈한 구체 음영 (의학 일러스트 톤). 보존 안: 변경 X.
  private drawTypeA(base: number, h: number, s: number, l: number, life: number): void {
    const bodyColor = hslToRgbInt(h, s, l);
    const rimColor = hslToRgbInt(h, s, clamp01x100(l - TYPE_A_RIM_L_DROP));
    const highlightColor = hslToRgbInt(
      h,
      clamp01x100(s - TYPE_A_HIGHLIGHT_S_DROP),
      clamp01x100(l + TYPE_A_HIGHLIGHT_L_BOOST),
    );

    const ox = base * TYPE_A_HIGHLIGHT_OFFSET;
    const oy = base * TYPE_A_HIGHLIGHT_OFFSET;

    scalePoints(this.buffer, this.bufferA, TYPE_A_BODY_SCALE);
    scalePoints(this.buffer, this.bufferB, TYPE_A_HIGHLIGHT_SCALE, ox, oy);

    // 1. Rim — 외곽 어두운 림.
    this.gfx.fillStyle(rimColor, 1);
    this.gfx.fillPoints(this.buffer, true);

    // 2. Body — 살짝 안쪽 본체.
    this.gfx.fillStyle(bodyColor, 1);
    this.gfx.fillPoints(this.bufferA, true);

    // 3. Highlight — 같은 polygon shape 의 축소판을 좌상단으로 살짝 옮겨서 그림.
    this.gfx.fillStyle(highlightColor, TYPE_A_HIGHLIGHT_ALPHA);
    this.gfx.fillPoints(this.bufferB, true);

    // 4. Specular — 작은 흰 점.
    if (TYPE_A_SPECULAR_RADIUS > 0) {
      const sr = base * TYPE_A_SPECULAR_RADIUS;
      this.gfx.fillStyle(0xffffff, TYPE_A_SPECULAR_ALPHA * life);
      this.gfx.fillCircle(ox * 1.3, oy * 1.3, sr);
    }
  }

  // 게임: TYPE_B — 발광/젖은 (네온·생체).
  //   외곽이 어두운 게 아니라 *밝게 번짐* (halo). 본체 채도 ↑. 안쪽 진한 빛.
  private drawTypeB(base: number, h: number, s: number, l: number, life: number): void {
    const bodyS = clamp01x100(s + TYPE_B_BODY_S_BOOST);
    const bodyColor = hslToRgbInt(h, bodyS, l);
    const haloColor = hslToRgbInt(
      h,
      clamp01x100(bodyS + TYPE_B_HALO_S_BOOST),
      clamp01x100(l + TYPE_B_HALO_L_BOOST),
    );
    const innerColor = hslToRgbInt(
      h,
      clamp01x100(bodyS - TYPE_B_INNER_S_DROP),
      clamp01x100(l + TYPE_B_INNER_L_BOOST),
    );

    const ox = base * TYPE_B_INNER_OFFSET;
    const oy = base * TYPE_B_INNER_OFFSET;

    // 1. Halo — body 보다 큰 polygon 을 밝은 색 + 알파로. 외곽이 부드럽게 번짐.
    scalePoints(this.buffer, this.bufferA, TYPE_B_HALO_SCALE);
    this.gfx.fillStyle(haloColor, TYPE_B_HALO_ALPHA * life);
    this.gfx.fillPoints(this.bufferA, true);

    // 2. Body — 채도 ↑ 본체.
    scalePoints(this.buffer, this.bufferA, TYPE_B_BODY_SCALE);
    this.gfx.fillStyle(bodyColor, 1);
    this.gfx.fillPoints(this.bufferA, true);

    // 3. Inner glow — 같은 shape 축소 + 좌상단 오프셋, 매우 밝은 색.
    scalePoints(this.buffer, this.bufferB, TYPE_B_INNER_SCALE, ox, oy);
    this.gfx.fillStyle(innerColor, TYPE_B_INNER_ALPHA * life);
    this.gfx.fillPoints(this.bufferB, true);

    // 4. Specular — 큰 흰 점 (젖은 느낌).
    if (TYPE_B_SPECULAR_RADIUS > 0) {
      const sr = base * TYPE_B_SPECULAR_RADIUS;
      this.gfx.fillStyle(0xffffff, TYPE_B_SPECULAR_ALPHA * life);
      this.gfx.fillCircle(ox * 1.3, oy * 1.3, sr);
    }
  }

  // 게임: TYPE_C — 만화풍 (두꺼운 외곽선 + 평면 톤).
  //   gradient/halo 없음. 외곽선은 strokePoints, 내부는 flat fill 두 단계 (셀쉐이드).
  private drawTypeC(base: number, h: number, s: number, l: number): void {
    const bodyColor = hslToRgbInt(h, s, l);
    const cellshadeColor = hslToRgbInt(
      h,
      s,
      clamp01x100(l + TYPE_C_CELLSHADE_L_BOOST),
    );
    const outlineColor = hslToRgbInt(
      h,
      clamp01x100(s - TYPE_C_OUTLINE_S_DROP),
      clamp01x100(l - TYPE_C_OUTLINE_L_DROP),
    );

    const ox = base * TYPE_C_CELLSHADE_OFFSET;
    const oy = base * TYPE_C_CELLSHADE_OFFSET;
    const outlineWidth = Math.max(TYPE_C_OUTLINE_WIDTH_MIN, base * TYPE_C_OUTLINE_WIDTH_RATIO);

    // 1. Body — 평면 톤 본체 (스케일 1 — 외곽선이 위에서 가두므로 축소 불필요).
    this.gfx.fillStyle(bodyColor, 1);
    this.gfx.fillPoints(this.buffer, true);

    // 2. Cell-shade — 작고 좌상단 오프셋된 같은 shape, 한 단계 밝은 flat 톤.
    scalePoints(this.buffer, this.bufferA, TYPE_C_CELLSHADE_SCALE, ox, oy);
    this.gfx.fillStyle(cellshadeColor, 1);
    this.gfx.fillPoints(this.bufferA, true);

    // 3. Outline — 두꺼운 진한 선. fill 위에 그려야 잉크처럼 가둠.
    this.gfx.lineStyle(outlineWidth, outlineColor, 1);
    this.gfx.strokePoints(this.buffer, true);
  }

  destroy(): void {
    this.gfx.destroy();
  }
}

// 게임: src 점들을 scale + offset 적용해서 dst 에 채움. 매 프레임 hot path.
//        out 패턴 — 객체 새로 만들지 않음. ox/oy 기본 0 → 중심 유지.
function scalePoints(src: Point[], dst: Point[], scale: number, ox = 0, oy = 0): void {
  for (let i = 0; i < src.length; i++) {
    dst[i].x = src[i].x * scale + ox;
    dst[i].y = src[i].y * scale + oy;
  }
}

// 게임: 영웅급 DNA 판별. 새 영웅급(예: NK) 추가하려면 여기에 한 줄.
function isHeroDna(dna: DNA): boolean {
  return dna.kind === 'BACTERIA_COMMANDER' || dna.kind === 'TCELL' || dna.kind === 'NEUTROPHIL_SUPER';
}

// 게임: 영웅 glow 색 — DNA hue 유지, 채도/명도만 ↑. 자기 색이 발산되는 인상.
function heroGlowColor(dna: DNA): number {
  return hslToRgbInt(
    dna.color.h,
    clamp01x100(dna.color.s + HERO_GLOW_S_BOOST),
    clamp01x100(dna.color.l + HERO_GLOW_L_BOOST),
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp01x100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

export class GraphicsCellRenderer implements CellRenderer {
  constructor(private scene: Phaser.Scene) {}

  create(dna: DNA, x: number, y: number): CellRenderHandle {
    return new GraphicsHandle(this.scene, dna, x, y);
  }
}
