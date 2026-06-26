// 장면 1: 혈관 속 (매크로 뷰).
// M1.5: 호중구 N마리 + 충격파 인터렉션
// M2.1: + 영양분 풀(40, 4초 리젠) + 세균 (영양분 추적, 분열) — 백혈구는 아직 관전
// M2.2: + drives(우선순위) + 관성 + 동족 분리력

import Phaser from 'phaser';
import { NEUTROPHIL, NEUTROPHIL_SUPER, NK_CELL, BCELL, TCELL, BACTERIA_A, BACTERIA_COMMANDER, MACROPHAGE } from '../domain/dna';
// 게임: WhiteCell 클래스 직접 import 제거 — spawn 은 whiteCellBehavior.spawn() 으로 통일됨.
import { Macrophage } from '../entities/Macrophage';
import { GraphicsCellRenderer } from '../render/GraphicsCellRenderer';
import type { CellRenderer, CellRenderHandle } from '../render/CellRenderer';
import type { DNA } from '../domain/dna';
import { ShockwaveSystem } from '../systems/ShockwaveSystem';
import { ShockwaveRenderer } from '../render/ShockwaveRenderer';
import { NutrientSystem } from '../systems/NutrientSystem';
import { NutrientRenderer } from '../render/NutrientRenderer';
import { BacteriaBehaviorSystem } from '../systems/BacteriaBehaviorSystem';
import { WhiteCellBehaviorSystem } from '../systems/WhiteCellBehaviorSystem';
import { ContactSystem } from '../systems/ContactSystem';
import { TeamSystem } from '../systems/TeamSystem';
import { MacrophageSystem } from '../systems/MacrophageSystem';
import { AntibodySystem } from '../systems/AntibodySystem';
import { AntibodyRenderer } from '../render/AntibodyRenderer';
import { applySeparation } from '../domain/separation';
import { pickMutation, applyMutation, type MutationKind } from '../domain/mutations';
import { STAGES } from '../stages/all';
import type { StageConfig, StageResult } from '../stages/types';
import { CUTSCENE_INTRO } from '../cutscenes/intro-script';
import type { CutsceneStep, WaitCondition } from '../cutscenes/types';
import { EntityRegistry } from '../domain/entityControl';
import { SoundSystem, getSoundSystem } from '../sound/SoundSystem';
import type { LivingCell } from '../entities/LivingCell';
import { getPerkState, resetPerkState, applyPerk, pickRandomPerks,
  getSkillCharges, resetSkillCharges, addStageSkillCharges, useNeutrophilCharge, useBacteriaCharge } from '../domain/perks';

// 게임: 초기 spawn 수는 Session 20 부터 StageConfig 로 이전 (src/stages/types.ts).
//   T/B세포/세균커맨더 배치는 Session 22 부터 cutscenes/intro-script.ts 의 place() step 으로 이전.

// 게임: 호중구 진화 임계 — level 도달 시 NK/BCELL/SUPER 무작위 변환.
const NEUTROPHIL_EVOLUTION_LEVEL = 5;

// 게임: 정지 항체 최대 개수. 초과 시 가장 오래된 것부터 자동 정리. 0 또는 음수면 무제한.
//        화면 누적 방지. 미세조정 가능 — 옵션으로 남김.
const ANTIBODY_MAX_STOPPED = 5;

// 게임: 영양분 슬롯 수 (고정). 소비 후 일정 지연 뒤 재활성화.
const NUTRIENT_COUNT = 40;
// 게임: 영양분 생성 영역 — 화면 사각 테두리에서 안쪽으로 이만큼 들여서 배치.
//       세균이 구석에 쏠려 영양분에 닿지 못하는 케이스 방지.
//       100 → 160 (Session 16) — 세균 baseRadius(18) + wobble + 분리력 여유.
// 게임: 영양분 분포 마진 (px) — 화면 가장자리에서 안쪽으로 이만큼 마진. (Session 20: 130→40 좁은 화면 대응)
//   너무 작으면 세균이 구석에 박힐 위험. 40 정도가 안전 (세균 base 9 + 분리력 padding 고려).
const NUTRIENT_MARGIN = 40;

// 게임: 호중구/세균 spawn 마진 (px) — 화면 가장자리에서 안쪽으로 이만큼 안. (Session 20: 100→30)
//   개체 base 가 절반으로 줄어 더 가장자리 가까이 spawn 가능. 영양분 마진 (40) 보다 작아도 OK.
const SPAWN_MARGIN = 30;

// 게임: 모바일 (?mobile) 시 게임 영역 하단 reserve px. iOS Safari URL 바 가림 대비.
//   effectiveHeight() = scale.height - 이만큼. bounds / spawn / 대식세포 floor 모두 적용.
//   CSS 100dvh 와 함께 — dvh 가 잡지 못하는 가림 영역까지 안전 마진 확보.
const BOTTOM_RESERVE_MOBILE = 80;
// 게임: 하단 스킬 버튼 바 높이 (px). 게임 영역(effectiveHeight) 을 이만큼 더 줄이고
//   그 아래 영역에 호중구/세균 추가 버튼 2개 배치. 데스크탑/모바일 공통.
const SKILL_BAR_HEIGHT = 64;
const NUTRIENT_RESPAWN_DELAY = 5;

// 게임: 충격파 자원/파동 파라미터.
const SHOCKWAVE_CONFIG = {
  maxCharges: 5,
  rechargeIntervalSec: 3,
  waveTemplate: {
    speed: 280,
    duration: 1.2,
    // 게임: 링 위 호중구가 받는 최대 가속도 (px/s²). ringFactor 가 제곱이라
    //   링에서 멀어지면 빠르게 작아짐 → power 가 클수록 "가까운 호중구만" 더 멀리 날아감.
    power: 1000,
    bandwidth: 50,
  },
};

// 게임: HUD 표시 헬퍼.
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// 게임: 커맨더 사망 후 일반 세균 1마리가 커맨더로 진화하기까지의 대기 시간 (초).
const COMMANDER_EVOLUTION_DELAY = 10;

// 게임: 분리력 파라미터. 같은 종족끼리 너무 붙는 것 방지.
//   padding  : base 합 외에 추가로 비워둘 거리
//   strength : 가속도 (px/s²). 강하면 빠르게 분리, 약하면 자연스럽게 떨어짐.
const SEPARATION_PADDING = 4;
const SEPARATION_STRENGTH = 400;

// 게임: 페이즈 2 바이러스 — 패턴별 이동.
//   parametric position (innerTime 기반) 으로 계산 — dt 적분 누적 오류 회피.
//   straight: spawn → 중앙 직선
//   zigzag  : 직선 경로 위에 수직 sin 진동
//   curve   : 중앙 기준 spiral (각속도 + 안쪽으로 이동)
type Virus = {
  kind: 'straight' | 'zigzag' | 'curve';
  bornTime: number;
  spawnX: number;
  spawnY: number;
  baseDirX: number;       // straight/zigzag: 정규화된 진행 방향
  baseDirY: number;
  speed: number;          // straight/zigzag: px/s
  amplitude: number;      // zigzag: 수직 진동 진폭 (px)
  frequency: number;      // zigzag: rad/s
  initialDist: number;    // curve: 중앙 → spawn 거리
  initialAngle: number;   // curve: 중앙 → spawn 각도
  angularVelocity: number; // curve: rad/s
  inwardSpeed: number;    // curve: 중앙 향한 px/s
  x: number;              // 현재 위치 (hit test 용)
  y: number;
  gfx: Phaser.GameObjects.Graphics;
};

// 게임: 쉴드 차단 시 바이러스 자리에 표시되는 소멸 이펙트.
//   bornTime: innerTime 기준 spawn 시각. duration 경과 시 자동 정리.
type ShieldHitEffect = {
  x: number;
  y: number;
  bornTime: number;
  gfx: Phaser.GameObjects.Graphics;
};

// 게임: 쉴드 차단 이펙트 파라미터.
//   원이 RADIUS_START → RADIUS_END 로 커지며 알파 1 → 0 으로 페이드.
const SHIELD_HIT_DURATION = 0.25;
const SHIELD_HIT_RADIUS_START = 6;
const SHIELD_HIT_RADIUS_END = 22;
const SHIELD_HIT_COLOR = 0x88ccff;

// 게임: 페이즈 2 wave 진행 상태. enterInside 에서 새로 만들고 exitInside 에서 null.
//   spawnQueue        : 남은 spawn 패턴 큐 (초기 WAVE_TOTAL 개)
//   nextSpawnTime     : innerTime 기준 다음 spawn 시각 (초)
//   hits              : DNA 도달 누적 카운트 (변이 매핑 입력)
//   resolved          : 변이 결정 완료 여부 (결과 표시 후 자동 복귀까지 한 번만)
//   resolvedAt        : finalize 시점 innerTime (자동 복귀 타이밍 측정)
//   shieldCharges     : 남은 쉴드 발동 횟수 (시작 WAVE_SHIELD_CHARGES)
//   shieldActiveUntil : 쉴드 활성 만료 시각 (innerTime). t 가 이 값 미만이면 쉴드 ON.
type WaveState = {
  spawnQueue: Virus['kind'][];
  nextSpawnTime: number;
  hits: number;
  resolved: boolean;
  resolvedAt: number;
  shieldCharges: number;
  shieldActiveUntil: number;
};

// 게임: 페이즈 2 wave 파라미터 (기획서 §2.12).
//   WAVE_TOTAL  : wave 당 바이러스 수 (10발)
//   WAVE_SPAWN_INTERVAL : 연속 spawn 간격 (초)
//   WAVE_FIRST_DELAY    : 진입 후 첫 발까지 여유 (시각 안정화)
//   WAVE_RESULT_DELAY   : 변이 결과 텍스트 표시 시간 (초) → 자동 페이즈 1 복귀
//   WAVE_KIND_DISTRIBUTION : 10발 패턴 분포 (4 직진 / 3 지그재그 / 3 커브). 매 wave shuffle.
const WAVE_TOTAL = 10;
const WAVE_SPAWN_INTERVAL = 0.8;
const WAVE_FIRST_DELAY = 0.6;
const WAVE_RESULT_DELAY = 1.5;
const WAVE_KIND_DISTRIBUTION: Virus['kind'][] = [
  'straight', 'straight', 'straight', 'straight',
  'zigzag', 'zigzag', 'zigzag',
  'curve', 'curve', 'curve',
];

// 게임: 변이 종류 → UI 라벨 (1~6 번호 + 한글). 기획서 §2.12 의 매핑.
const MUTATION_INFO: Record<MutationKind, { num: number; label: string }> = {
  zombie:      { num: 1, label: '좀비 (아군 공격)' },
  cancer:      { num: 2, label: '암세포 (분열↑)' },
  corruption:  { num: 3, label: '형태 붕괴' },
  hyperactive: { num: 4, label: '과민 반응' },
  paralysis:   { num: 5, label: '마비' },
  chaos:       { num: 6, label: '카오스 (랜덤)' },
};

// 게임: DNA 시각화 — 10 세그먼트. hit 카운트 만큼 인덱스 0 부터 corrupted (빨강 톤).
//   기획서 §2.12 의 시각용 추상 — 게임 로직은 hits 카운트만 사용.
const DNA_SEGMENTS = 10;

// 게임: 쉴드 (Stage 4 — 단일 쉴드 안).
//   유저 클릭 → DNA 자체에 ~0.3s 동안 쉴드 활성, 그 사이 DNA 중심에 도달한 바이러스는
//   hits 미증가 + 즉시 소멸. 한 번의 쉴드로 같은 타이밍의 다발 바이러스 다 막힘.
//   바이러스 속도 랜덤화로 도달 타이밍이 흩어져 "한 번에 몰린 순간" 이 생김.
const WAVE_SHIELD_CHARGES = 5;
const WAVE_SHIELD_DURATION = 0.3;
// 게임: DNA 라인 두께 — 평소(strand 2.5/pair 1.2) → 쉴드 활성 시 두꺼움.
//   별도 링/콘 없이 DNA 선 자체가 굵어지는 펄스로 쉴드 시각 표현.
const DNA_STRAND_WIDTH = 2.5;
const DNA_STRAND_WIDTH_SHIELD = 5.5;
const DNA_PAIR_WIDTH = 1.2;
const DNA_PAIR_WIDTH_SHIELD = 3.0;

// 게임: 바이러스 spawn 속도 랜덤 범위 (px/s).
//   모든 패턴 (직진/지그재그/커브) 의 baseline speed — 도달 타이밍이 흩어지도록 랜덤.
const VIRUS_SPEED_MIN = 40;
const VIRUS_SPEED_MAX = 80;

// 게임: 바이러스 자동 제거 조건 — 풍선 밖으로 나가거나 너무 오래 살면 hit 미증가로 소멸.
//   zigzag 진동 폭 (±25~40px) 이 HIT_RADIUS(16) 보다 커서 정중앙 빗나갈 수 있음 — 그러면 영원히 진행.
//   풍선 밖 = "안 맞히고 지나감" 처리. 수명 만료는 안전망 (curve 가 dist 0 머무는 케이스 등).
const VIRUS_OUTOFBOUND_MARGIN = 20;
const VIRUS_MAX_LIFETIME = 8;

// 게임: PhaseBubble — 호중구 호스트당 1개. 화면 우상단부터 세로 정렬, host 와 꼬리 line 연결.
//   외부 sim 과 동시 진행 — bubble.localTime 은 외부 gameTime 과 dt 공유 (speedMultiplier 도).
//   클릭 hit test 는 풍선 사각 영역 (centerX±size/2, centerY±size/2).
//   host 사망 시 closeBubble 즉시 호출 — 변이 적용 X.
type PhaseBubble = {
  host: import('../entities/WhiteCell').WhiteCell;
  localTime: number;                      // 풍선 안 시간 (초). spawn 시 0.
  spawnedAt: number;                      // gameTime 기준 등장 시각 (페이드 인 용).
  resolvedAt: number | null;              // wave 종료 후 closeBubble 까지 카운트다운 기준.
  centerX: number;                        // 화면 풍선 중심 X
  centerY: number;                        // 화면 풍선 중심 Y
  size: number;                           // 풍선 한 변 (정사각형, 둥근 모서리)
  wave: WaveState;
  viruses: Virus[];
  shieldHitEffects: ShieldHitEffect[];
  frameGfx: Phaser.GameObjects.Graphics;  // 둥근 사각형 + 꼬리 line
  contentsGfx: Phaser.GameObjects.Graphics; // DNA 나선
  virusLayer: Phaser.GameObjects.Container; // 바이러스/쉴드 이펙트 부모 (풍선 중심 origin)
  hudText: Phaser.GameObjects.Text;
  resultText: Phaser.GameObjects.Text;
  closed: boolean;                        // 정리 중 플래그 (중복 close 방지) — destroy 후 true
  closing: boolean;                       // 페이드 아웃 진행 중. wave/클릭 갱신 스킵.
  closeStartedAt: number;                 // closing=true 가 된 gameTime 시각.
};

// 게임: 풍선 크기 + 위치 + 외형 상수.
//   BUBBLE_SIZE      — 한 변 (px). 화면 작아도 잘 보이도록 240 고정.
//   BUBBLE_MARGIN_*  — 화면 가장자리에서 풍선 중심까지 여백.
//   BUBBLE_SPACING   — 풍선 N개 세로 정렬 시 중심간 간격.
//   BUBBLE_MAX       — 동시 최대 풍선 수 (Stage A 는 1, Stage C 에서 3 로).
const BUBBLE_SIZE = 240;
const BUBBLE_MARGIN_RIGHT = 30;
const BUBBLE_MARGIN_TOP = 30;
const BUBBLE_SPACING = 20;
const BUBBLE_MAX = 3;
// 게임: 풍선 외형 — 머그캵 둥근 사각형 + 꼬리.
const BUBBLE_CORNER_RADIUS = 24;
const BUBBLE_BG_COLOR = 0x0a0a14;
const BUBBLE_BG_ALPHA = 0.85;
const BUBBLE_BORDER_COLOR = 0x88ccff;
const BUBBLE_BORDER_WIDTH = 2;
// 게임: 꼬리 — 풍선 가장자리 → host 까지 직선. Stage B 에서 곡선 폴리싱.
const BUBBLE_TAIL_COLOR = 0x88ccff;
const BUBBLE_TAIL_WIDTH = 1.5;
const BUBBLE_TAIL_ALPHA = 0.6;
// 게임: 풍선 안 HIT_RADIUS (DNA 중앙 도달 판정). 기존 화면 좌표계와 동일하지만 풍선 좌표계 기준.
const VIRUS_HIT_RADIUS = 16;
// 게임: 풍선 페이드 인/아웃 시간 (초). 갑작스러운 팝업 제거 + 닫힘 시 부드러운 사라짐.
//   spawnedAt 부터 FADE_DURATION 까지 alpha 0→1. closing 후 FADE_DURATION 까지 alpha 1→0 → destroy.
const BUBBLE_FADE_DURATION = 0.3;
// 게임: 풍선 그래픽 depth — 다른 모든 게임 객체 (default depth 0) 위로 그려지게.
//   같은 depth 안에서는 spawn 순서로 정렬 — 나중 풍선이 위로.
const BUBBLE_DEPTH = 1000;

// 게임: hyperactive 변이 폭발 반경 (px). pendingHyperactiveExplosion=true 인 호중구 위치 기준.
//   반경 내 모든 살아있는 LivingCell (호중구 + 세균) → isAbsorbed=true 즉사. 본인은 이미 isAbsorbed.
const HYPERACTIVE_EXPLOSION_RADIUS = 200;

// 게임: paralysis 외부 전파 반경 (px) + 부여 시간 (초).
//   변이 호중구 cycle active 시 인접 paralyzed 정상 호중구 (mutation=null) 에 paralyzedUntil 갱신.
//   1단계 전파만 — 전파된 호중구는 자기 cycle 없으므로 추가 전파 X.
const PARALYSIS_PROPAGATION_RADIUS = 60;
const PARALYSIS_PROPAGATION_DURATION = 0.5;

// 게임: 컷신 단어별 타이핑 속도 (초/단어). 한 라인 끝나면 라인 간 pause 추가.
//   너무 빠르면 못 따라 읽음 + 너무 느리면 답답. 0.12 = 자연 속도.
const CUTSCENE_WORD_INTERVAL = 0.12;
// 게임: 컷신 라인 사이 자동 pause (초). 한 라인 끝 → 다음 라인 시작까지.
const CUTSCENE_LINE_PAUSE = 0.4;
// 게임: 단계 6 — CUTSCENE_ACTION_PLACEHOLDER_DURATION 제거 (ACTION 핸들러 자체가 제거됨).

// 게임: 페이즈 2 hit 성공 확률 (Session 19).
//   바이러스가 DNA 중심 도달했을 때 hit++ 적용될 확률. 1.0 = 적중 = 무조건 hit.
//   관전 모드 (기본): 0.4 — 자체 면역으로 60% 자동 차단. 쉴드 없어도 변이율 조절.
//   개입 모드: 1.0 — 사용자가 쉴드로 막아야. 쉴드는 추가 보장.
const HIT_PROB_INTERACTIVE = 1.0;
const HIT_PROB_OBSERVE = 0.4;

// 게임: 대식세포 수동 조작 유예 시간 (초, gameTime 기준).
//   cursor 키 (← →) 누름 시 manualUntil = gameTime + 이 값. 키 떼도 만료 전엔 마지막 방향 유지.
//   만료 후 자동 모드 (nearest 시체 추적) 복귀. 빨리감기 시 게임 시간 기준이라 자동 비례 단축.
const MACROPHAGE_MANUAL_TIMEOUT = 0.5;

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
  private antibodySystem!: AntibodySystem;
  private antibodyRenderer!: AntibodyRenderer;
  // 게임: 모든 개체 종류의 등장·표시·정지·속도·확률 통합 제어 (단계 1~2).
  //   컷신 / 디버그 / 스테이지 셋업이 entityRegistry.set() 으로 dimension 제어 →
  //   각 시스템이 매 프레임 조회하여 분기.
  private entityRegistry!: EntityRegistry;
  // 게임: Tone.js 기반 사운드. 첫 pointerdown 시 ensureStarted (모바일 AudioContext 제약).
  //   매 프레임 새 사망 검출 → playWhiteCellDeath / playBacteriaDeath.
  private soundSystem!: SoundSystem;
  // 게임: 이미 사운드 트리거된 cell 추적 (중복 재생 방지). WeakSet — cell GC 시 자동 청소.
  private deadNotified = new WeakSet<LivingCell>();
  // 게임: 특전 선택 화면 표시 중 flag. true 면 [SPACE] 무시 + 카드 클릭 대기.
  private perkSelecting = false;
  // 게임: 스킬 충전은 perks.ts 의 module singleton (getSkillCharges). 누적 + 사용 차감 이월.
  //   여기선 버튼 UI refs 만 보유.
  private skillNeutBg!: Phaser.GameObjects.Graphics;
  private skillBactBg!: Phaser.GameObjects.Graphics;
  private skillNeutText!: Phaser.GameObjects.Text;
  private skillBactText!: Phaser.GameObjects.Text;
  private skillNeutZone!: Phaser.GameObjects.Zone;
  private skillBactZone!: Phaser.GameObjects.Zone;
  private hudText!: Phaser.GameObjects.Text;
  private fpsText!: Phaser.GameObjects.Text;
  // 게임: 키 안내 줄 — 변수로 잡아 [H] 토글 대상에 포함.
  private controlsText!: Phaser.GameObjects.Text;
  // 게임: 상단 디버그 텍스트 표시 여부. [H] 키 토글. 기본 true (개발/검수 편의).
  //   영향 대상: hudText, fpsText, controlsText, debugHud. stageHudText 는 게임플레이용이라 제외.
  //   ?mobile 접속 시 create 에서 false 로 강제 (모바일 화면 점유 절약).
  private debugVisible = true;
  // 게임: 모바일 모드 (?mobile 또는 ?portrait URL 파라미터). create 에서 set.
  //   영향: 디버그 텍스트 기본 OFF + pointerup swipe 로 속도 변경 (탭은 충격파 그대로).
  private isMobile = false;
  // 게임: 모바일 swipe 검출용 — pointerdown 시작 위치 + 진행 중 flag.
  //   pointerup 시 거리/방향 검사 → swipe 면 속도 변경, 아니면 짧은 탭 (충격파/풍선) 분기.
  private touchStartX = 0;
  private touchStartY = 0;
  private touchDown = false;
  private placementText!: Phaser.GameObjects.Text;
  // 게임: 스테이지 HUD (Session 20) — 화면 상단 중앙 카운트다운 + 세균 진행.
  private stageHudText!: Phaser.GameObjects.Text;
  private paused = false;
  // 게임: 가상 시간 + 빨리감기. Phaser 의 this.time.now 대신 사용.
  //        speedMultiplier 1=정상, 2=2배, 4=4배. update 에서 dt 에 곱.
  private gameTime = 0;
  private speedMultiplier = 1;

  // 게임: 게임 단계.
  //   cutscene — 인트로 컷신 진행 중 (Session 21). 외부 sim 정지, 텍스트 박스 + 클릭으로 진행.
  //   placing  — 주요 캐릭 (T세포/세균커맨더/B세포) 마우스 배치 중. 시뮬레이션 정지.
  //   running  — 정상 혈관 뷰 시뮬레이션. 페이즈 2 (PhaseBubble) 는 풍선 레이어로 동시 진행.
  private phase: 'cutscene' | 'placing' | 'running' = 'cutscene';

  // 게임: 컷신 상태 (Session 21). create() 에서 CUTSCENE_INTRO 로 초기화.
  //   steps        — 시퀀스 배열 (narration/action/end).
  //   stepIndex    — 현재 step.
  //   lineIndex    — narration 내 현재 라인.
  //   wordIndex    — 현재 라인의 표시된 단어 수.
  //   wordTimer    — 다음 단어까지 남은 시간 (초).
  //   linePause    — 라인 사이 pause 남은 시간 (모두 표시 후 다음 라인 전).
  //   awaitingClick — 모든 라인 표시 완료 후 클릭 대기.
  //   actionTimer  — ACTION step 진행 시간 (초).
  //   actionStarted — ACTION 한 번만 spawn 처리 (placeholder 는 timer 만).
  //   uiBg / uiText / uiHint — 텍스트 박스 그래픽 객체 (lazy 생성).
  private cutsceneSteps: CutsceneStep[] = CUTSCENE_INTRO;
  // 게임: 현재 cutscene 이 stage intro 인지 (true) 글로벌 CUTSCENE_INTRO 인지 (false) 구분.
  //   endCutscene 분기 — false=CUTSCENE_INTRO 끝 → startStageFlow, true=stage.intro 끝 → 본게임.
  private cutsceneIsStageIntro = false;
  private cutsceneStepIndex = 0;
  private cutsceneLineIndex = 0;
  private cutsceneWordIndex = 0;
  private cutsceneWordTimer = 0;
  private cutsceneLinePause = 0;
  private cutsceneAwaitingClick = false;
  private cutsceneActionTimer = 0;
  private cutsceneUiBg: Phaser.GameObjects.Graphics | null = null;
  private cutsceneUiText: Phaser.GameObjects.Text | null = null;
  private cutsceneUiHint: Phaser.GameObjects.Text | null = null;
  // 게임: warning step 의 흔들림 효과 — base 위치 보존, 매 프레임 ±jitter 오프셋.
  //   narration 진입 시 base 로 복원, warning 진입 시 색/스타일만 바뀌고 위치는 jitter 가 매 프레임 갱신.
  private cutsceneTextBaseX = 0;
  private cutsceneTextBaseY = 0;
  // 게임: 단계 6 — 기존 ACTION 핸들러 멤버들 (cutsceneSimActive / cutsceneNutPhase 등) 제거.
  //   intro-script 가 선언적 control()/spawn()/pause() 로 마이그레이션됨.
  //   sim 활성/정지는 control('xxx', { frozen }) 으로 대본이 직접 제어.
  //
  // 게임: 선언적 spawn step 의 진행 카운터 (단계 5). 현재 step 에서 이미 처리한 개수.
  //   step 시작 시 0 으로 reset. interval>0 마다 +1, count 도달 시 sparkle phase 또는 advance.
  private cutsceneSpawnDone = 0;
  // 게임: 영양분 동적 부활 속도 조절 규칙. nutrientRegen step 의 slowWhenBacteriaAbove 에 의해 set.
  //   매 프레임 살아있는 세균 수 검사 → 임계 이상이면 NutrientSystem.respawnDelayMul = 1/regenMul.
  //   임계 이하면 1 (정상 속도). null = 규칙 없음 (항상 정상).
  //   컷신 종료 (endCutscene) 또는 다른 nutrientRegen step (slowWhenBacteriaAbove 없는) 시 null 로 reset.
  private nutrientRegenRule: { count: number; regenMul: number } | null = null;
  // 게임: waitForShockwaves step 진입 후 발사된 충격파 카운터. handleRunningTap 의 trySpawn 성공 시 ++.
  //   step 진입 시 0 reset → 그 후 발사만 카운트.
  private shockwaveCounter = 0;
  // 게임: waitForBacteriaKilled step 진입 시점의 stageKilled baseline.
  //   매 프레임 (현재 stageKilled - baseline) >= count 면 advance.
  private cutsceneBacteriaKilledBaseline = 0;
  // 게임: waitForMacrophageProductions step 진입 시점의 productionCount baseline.
  //   매 프레임 (현재 productionCount - baseline) >= count 면 advance.
  private cutsceneMacrophageProductionBaseline = 0;
  // 게임: sparkle 효과 상태 — spawn step 의 sparkleSeconds > 0 일 때 spawn 완료 후 사용.
  //   positions : spawn 한 위치들 (sparkle 그릴 좌표)
  //   gfx       : 매 프레임 strokeCircle 그리는 Graphics. sparkle 종료 시 destroy.
  //   startTime : cutsceneActionTimer 기준 sparkle 시작 시점 (이전엔 spawn 진행 중).
  private cutsceneSpawnPositions: { x: number; y: number }[] = [];
  private cutsceneSparkleGfx: Phaser.GameObjects.Graphics | null = null;
  private cutsceneSparkleStartTime = 0;
  // 게임: 스테이지 시작 시각 (gameTime 기준, Session 21 Stage B). running 진입 시점에 기록.
  //   cutscene 동안 gameTime 진행되므로 stage HUD/wave/판정 비교 시 (gameTime - stageStartTime).
  private stageStartTime = 0;

  // 게임: 활성 풍선 (페이즈 2) 풀. Session 18 — cam2 줌인 → host 별 풍선 레이어로 교체.
  //   외부 sim 정지 X. 매 프레임 updateBubbles 가 각 풍선의 wave/바이러스/쉴드 진행.
  //   최대 3개 동시 (BUBBLE_MAX). infected 트리거 시 풀 가득 차 있으면 무시.
  private bubbles: PhaseBubble[] = [];
  // 게임: 페이즈 2 인터렉션 모드 (Session 19). false=관전 (기본), true=개입.
  //   관전: 풍선 클릭 무시 + hit 확률 0.4. 개입: 풍선 클릭=쉴드 + hit 확률 1.0.
  //   [I] 키 토글. 게임 중 어디서나 전환 가능, 진행 중인 wave 에도 즉시 반영.
  private interactive = false;
  // 게임: cursor 키 — 대식세포 수동 조작 (Session 19). create 에서 셋업.
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  // 게임: 스테이지 시스템 (Session 20).
  //   currentStageIndex — STAGES 배열 인덱스 (0~9). init(data) 에서 받아 set.
  //   currentStage    — 현재 활성 스테이지 config (스폰/판정 기준).
  //   stageState      — running 중 / 결과 표시 중 / 종료. 결과 후 sim 정지.
  //   nextWaveIndex   — stage.waves 의 다음 처리할 인덱스. 매 프레임 atSec 도달 검사.
  //   skipIntro       — restart 시 인트로/배치 스킵 (다음 스테이지 진입용). init 에서 set.
  //   stageResult     — 평가 결과 (결과 모달 표시용). null = 진행 중.
  //   stageResultText — 결과 모달 텍스트 객체 (생성 시 lazy).
  private currentStageIndex = 0;
  private currentStage: StageConfig = STAGES[0];
  private stageState: 'running' | 'resolved' = 'running';
  private nextWaveIndex = 0;
  private skipIntro = false;
  private lastStageResult: StageResult | null = null;
  private debugHud!: Phaser.GameObjects.Text;
  // 게임: 배치 큐. 순서대로 클릭으로 배치. 비면 phase='running'.
  private placementQueue: { dna: DNA; label: string }[] = [];
  private placementHandle: CellRenderHandle | null = null;
  // 게임: 마우스 마지막 위치 (placement 미리보기용).
  private pointerX = 0;
  private pointerY = 0;

  constructor() {
    super('BloodScene');
  }

  // Phaser: create() 직전에 호출 — scene.restart(data) 의 data 수신.
  //   stageIndex   — 진입할 스테이지 (0~9). 생략/0 = 첫 스테이지.
  //   skipIntro    — true 면 CUTSCENE_INTRO + 배치 단계 스킵 → 바로 stage 진입.
  //                  다음 스테이지 진입 시 true. retry 시 false.
  //
  //   ⚠️ scene.restart 는 인스턴스를 재구성하지 않음 (init/create 만 다시 호출). 클래스 필드는
  //   이전 값 유지 — phase, cutsceneIsStageIntro 등 안전한 초기값 명시 리셋 필요.
  init(data?: { stageIndex?: number; skipIntro?: boolean }): void {
    this.currentStageIndex = Math.max(0, Math.min(STAGES.length - 1, data?.stageIndex ?? 0));
    this.currentStage = STAGES[this.currentStageIndex];
    this.skipIntro = data?.skipIntro ?? false;
    // 게임: 안전 리셋 — 이전 run 잔존값 차단. showStageTitle 3초 대기 동안 SIM 이 잘못 돌면
    //   checkStageResolution 가 빈 풀에서 호중구 0 → wipe 오판정. phase='cutscene' 으로 SIM 차단.
    //   cutsceneSteps 도 빈 배열로 — 3초 대기 동안 updateCutscene 이 이전 스테이지의 stale step 을
    //   처리하지 않도록 (handleCutsceneTap 의 stale step 라우팅도 차단).
    this.phase = 'cutscene';
    this.cutsceneIsStageIntro = false;
    this.cutsceneSteps = [];
    this.cutsceneStepIndex = 0;
    this.cutsceneAwaitingClick = false;
    this.cutsceneUiBg = null;
    this.cutsceneUiText = null;
    this.cutsceneUiHint = null;
    this.lastStageResult = null;
    this.perkSelecting = false;
    // 게임: 첫 스테이지 (index 0) 진입 = 게임 처음 → 특전 누적 초기화.
    //   다음 스테이지로의 restart (skipIntro=true) 시엔 누적 유지.
    if (this.currentStageIndex === 0) resetPerkState();
  }

  // Phaser: 씬 시작 시 1회 호출.
  create(): void {
    // 게임: 모바일 모드 감지 — URL 파라미터 ?mobile 또는 ?portrait.
    //   영향: 디버그 텍스트 기본 OFF, pointer 가 swipe 검출.
    const params = new URLSearchParams(window.location.search);
    this.isMobile = params.has('mobile') || params.has('portrait');
    this.touchDown = false;
    // 게임: 리셋 시 가상 시간 초기화 (scene.restart() 가 같은 인스턴스 재사용).
    this.gameTime = 0;
    this.speedMultiplier = 1;
    this.paused = false;
    // 게임: 풍선 풀 초기화. 매 create() 마다 비움 (restart 시 stale ref 회피).
    //   create 시점엔 graphics 객체가 이미 sceneRestart 로 destroy 됐으므로 ref 만 정리.
    this.bubbles = [];
    // 게임: 모드 초기화. restart 시에도 관전 디폴트 유지 (사용자가 다시 [I] 로 켜야).
    this.interactive = false;
    // 게임: cursor 키 (← →) — 대식세포 수동 조작 (Session 19). create 한 번만 — restart 시 재생성됨.
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
    }
    const W = this.scale.width;
    const H = this.effectiveHeight();

    this.cellRenderer = new GraphicsCellRenderer(this);
    this.shockwaveRenderer = new ShockwaveRenderer(this);
    this.nutrientRenderer = new NutrientRenderer(this);
    this.antibodyRenderer = new AntibodyRenderer(this);

    // 게임: EntityRegistry 먼저 생성 — 시스템들이 생성자로 받음. 모든 종 디폴트.
    this.entityRegistry = new EntityRegistry();
    // 게임: 사운드 시스템 — 싱글톤. scene.restart() 마다 새로 만들면 synth 누적 → 메모리/오디오 노드 누수.
    //   getSoundSystem() 가 첫 호출에 인스턴스 생성, 이후 재사용.
    this.soundSystem = getSoundSystem();
    this.deadNotified = new WeakSet();
    // 게임: AudioContext 시작 — 첫 사용자 인터렉션에서. 모바일 정책 대응.
    //   현재 이벤트 사운드 (사망/분열/흡수/fusion/공격명령) 만 활성. 멜로디 (notifyContacts) 는 OFF.
    this.input.once('pointerdown', () => this.soundSystem.ensureStarted());
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown', () => this.soundSystem.ensureStarted());
    }

    this.shockwaveSystem = new ShockwaveSystem({
      ...SHOCKWAVE_CONFIG,
      initialTime: 0,  // 가상 시간 시작점
    });
    this.nutrientSystem = new NutrientSystem(
      NUTRIENT_COUNT,
      { width: W, height: H, margin: NUTRIENT_MARGIN },
      NUTRIENT_RESPAWN_DELAY,
      this.entityRegistry,
    );
    this.antibodySystem = new AntibodySystem(ANTIBODY_MAX_STOPPED, this.entityRegistry);
    this.bacteriaBehavior = new BacteriaBehaviorSystem(this.cellRenderer, this.entityRegistry);
    this.whiteCellBehavior = new WhiteCellBehaviorSystem(this.cellRenderer, this.antibodySystem, this.entityRegistry);
    this.contactSystem = new ContactSystem();
    this.teamSystem = new TeamSystem();
    this.macrophageSystem = new MacrophageSystem(this.entityRegistry);

    // 게임: 스테이지 상태 초기화. init(data) 가 set 한 currentStageIndex / Stage 사용.
    //   restart(data) 없이 호출되면 첫 스테이지(인덱스 0).
    this.stageState = 'running';
    this.nextWaveIndex = 0;
    this.stageStartTime = 0;
    this.bacteriaBehavior.resetStageCounters();

    // 게임: 스테이지 시작 spawn (호중구/세균/대식세포) 은 컷신 종료 시점 (endCutscene) 으로 미룸.
    //   컷신 도중 호중구가 보이면 안 됨 — populateStageStart() 가 endCutscene 에서 호출.

    // 게임: placement queue 는 컷신/스테이지 스크립트의 place() step 이 채움 (Session 22).
    //   하드코딩된 3개 (TCELL/COMMANDER/BCELL) 는 cutscenes/intro-script.ts 의 place() 로 이전.
    this.placementQueue = [];

    // Phaser: pointer 이벤트.
    //   placement 중: 미리보기 핸들 위치 갱신 + 클릭 시 spawn + 다음 슬롯
    //   running 중: 클릭 시 충격파 발사 (가상 시간 기준)
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.pointerX = pointer.x;
      this.pointerY = pointer.y;
      if (this.phase === 'placing' && this.placementHandle !== null) {
        this.placementHandle.setPosition(pointer.x, pointer.y);
      }
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // 게임: 스킬 바 영역 (effectiveHeight 아래) 클릭은 게임 입력 제외 — 하단 버튼 Zone 이 처리.
      if (pointer.y > this.effectiveHeight()) return;
      // 게임: 모바일 + (cutscene 또는 running) — pointerup 에서 swipe vs 탭 분기.
      //   pointerdown 은 시작 좌표 기록만. swipe 가 cutscene 진행 중에도 동작 (속도 조절).
      //   placing 은 즉시 처리 (짧은 탭만 의도).
      if (this.isMobile && (this.phase === 'cutscene' || this.phase === 'running')) {
        this.touchStartX = pointer.x;
        this.touchStartY = pointer.y;
        this.touchDown = true;
        return;
      }
      // 데스크탑 또는 placing — 기존 즉시 처리. cutscene 은 step 타입 별 분기.
      if (this.phase === 'cutscene') { this.handleCutsceneTap(pointer.x, pointer.y); return; }
      if (this.phase === 'placing') { this.confirmPlacement(pointer.x, pointer.y); return; }
      if (this.phase !== 'running') return;
      this.handleRunningTap(pointer.x, pointer.y);
    });
    // 게임: 모바일 swipe 검출 — pointerup 시 거리/방향 판정. cutscene + running 둘 다.
    //   세로 swipe ↑ = 속도 ↑ (1→2→4), ↓ = 속도 ↓ (4→2→1).
    //   거리 임계 미달 또는 가로 우세 = 짧은 탭 → phase 별 분기 (cutscene click 또는 충격파/풍선).
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isMobile) return;
      if (!this.touchDown) return;
      this.touchDown = false;
      if (this.phase !== 'cutscene' && this.phase !== 'running') return;
      const dx = pointer.x - this.touchStartX;
      const dy = pointer.y - this.touchStartY;
      const SWIPE_MIN_PX = 60;       // 이 거리 이상 + 세로 우세 → swipe
      const SWIPE_VERT_RATIO = 1.5;  // |dy| 가 |dx| × 이 비율 초과해야 세로 swipe
      if (Math.abs(dy) >= SWIPE_MIN_PX && Math.abs(dy) > Math.abs(dx) * SWIPE_VERT_RATIO) {
        this.bumpSpeed(dy < 0 ? +1 : -1);
        return;
      }
      // 짧은 탭 — phase 별 처리. cutscene 은 step 타입 별 분기.
      if (this.phase === 'cutscene') this.handleCutsceneTap(pointer.x, pointer.y);
      else this.handleRunningTap(pointer.x, pointer.y);
    });

    this.add.text(20, 20, '화면 터치 스크롤 위 아래로 속도 조절', {
      color: '#aaa',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '14px',
    });
    this.hudText = this.add.text(20, 40, '', {
      color: '#fc8',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '14px',
    });
    this.fpsText = this.add.text(20, 60, '', {
      color: '#8cf',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '14px',
    });
    this.controlsText = this.add.text(20, 80, '[N]+호중구10  [B]+세균10  [P]일시정지  [R]리셋  [1/2/3] 1x/2x/4x  [←→]대식세포  [I]개입/관전  [M]무작위변이  [Shift+1~6]변이1~6  [Z]풍선  [H]디버그토글', {
      color: '#888',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
    });
    // 진단: 항상 보이는 디버그 HUD — phase + cam2 + inner 상태.
    this.debugHud = this.add.text(20, 100, '', {
      color: '#ff8',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
    });
    // 게임: 모바일 모드 — 디버그 텍스트 4개 기본 OFF (화면 점유 절약). [H] 키는 그대로 동작.
    if (this.isMobile) {
      this.debugVisible = false;
      this.applyDebugVisible();
    }
    // 게임: 스테이지 카운트다운 HUD — 화면 상단 중앙. 시간 mm:ss + 세균 진행 표시.
    this.stageHudText = this.add.text(W / 2, 24, '', {
      color: '#ffffff',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '20px',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.stageHudText.setOrigin(0.5, 0.5);
    // 게임: 화면 중앙 안내 텍스트 — placement 중에만 표시.
    this.placementText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 60, '', {
      color: '#fff',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '24px',
      align: 'center',
    });
    this.placementText.setOrigin(0.5, 0.5);

    // 게임: 스킬 충전은 singleton (누적). 첫 스테이지 진입 시에만 초기화 (1/1).
    //   다음 스테이지로의 restart 시엔 유지 — addStageSkillCharges 로 +1, 사용분은 차감된 채.
    if (this.currentStageIndex === 0) resetSkillCharges();
    this.createSkillButtons();

    // 게임: 컷신 시작 (Session 21) — 첫 스테이지에만. skipIntro = 다음 스테이지 진입.
    //   컷신 끝나면 자동으로 beginNextPlacement → 본게임 진입.
    //   영양분 시스템 frozen + disableAll — 컷신 동안 spawnAt 5개 외 어떤 영양분도 등장 X.
    //   세균이 영양분 흡수해도 frozen 이라 부활 차단.
    this.nutrientSystem.frozen = true;
    this.nutrientSystem.disableAll();
    if (this.skipIntro) {
      // 게임: 다음 스테이지 진입 — CUTSCENE_INTRO / 배치 스킵. 바로 stage 타이틀.
      this.placementQueue = [];
      this.startStageFlow();
    } else {
      // 게임: 첫 진입 — 글로벌 CUTSCENE_INTRO 먼저 → 종료 시 stage flow.
      this.cutsceneSteps = CUTSCENE_INTRO;
      this.cutsceneIsStageIntro = false;
      this.beginCutscene();
    }

    // Phaser: 디버그 키. scene.restart() 시 자동 정리되고 create 에서 재등록.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-N', () => this.spawnNeutrophils(10));
      kb.on('keydown-B', () => this.spawnBacteria(10, 2));
      kb.on('keydown-P', () => { this.paused = !this.paused; });
      // 게임: [R] 현재 스테이지 재시작 — init data 로 currentStageIndex 유지, skipIntro=true (intro 반복 방지).
      //   첫 스테이지 (index 0) 에서는 skipIntro=false 라야 CUTSCENE_INTRO 가 다시 나옴 (디버그 편의).
      kb.on('keydown-R', () => this.scene.restart({
        stageIndex: this.currentStageIndex,
        skipIntro: this.currentStageIndex > 0,
      }));
      // 게임: [SPACE] 결과 모달에서 다음 스테이지로 진행. 1★ 이상이면 가능 (clear / timeout ★1+).
      //   0★ (wipe / timeout 실패) 는 무시. 마지막 스테이지도 무시 (게임 종료).
      kb.on('keydown-SPACE', () => {
        if (this.stageState !== 'resolved') return;
        if ((this.lastStageResult?.stars ?? 0) < 1) return;
        const next = this.currentStageIndex + 1;
        if (next >= STAGES.length) return;
        if (this.perkSelecting) return;  // 이미 특전 화면 표시 중
        // 게임: 다음 스테이지 진입 전 특전 선택 화면 — 카드 클릭 시 applyPerk + restart.
        this.showPerkSelect(next);
      });
      // 게임: 숫자키 1~3 = speed multiplier (shift 없음). shift+1~6 = 변이 1~6 (디버그).
      //   Phaser keydown 콜백 인자 = KeyboardEvent. shiftKey 검사로 분기.
      kb.on('keydown-ONE',   (e: KeyboardEvent) => { if (e.shiftKey) this.debugApplyMutation('zombie'); else this.speedMultiplier = 1; });
      kb.on('keydown-TWO',   (e: KeyboardEvent) => { if (e.shiftKey) this.debugApplyMutation('cancer'); else this.speedMultiplier = 2; });
      kb.on('keydown-THREE', (e: KeyboardEvent) => { if (e.shiftKey) this.debugApplyMutation('corruption'); else this.speedMultiplier = 4; });
      kb.on('keydown-FOUR',  (e: KeyboardEvent) => { if (e.shiftKey) this.debugApplyMutation('hyperactive'); });
      kb.on('keydown-FIVE',  (e: KeyboardEvent) => { if (e.shiftKey) this.debugApplyMutation('paralysis'); });
      kb.on('keydown-SIX',   (e: KeyboardEvent) => { if (e.shiftKey) this.debugApplyMutation('chaos'); });
      // 게임: [Z] 디버그 — 무작위 NEUTROPHIL 호스트로 풍선 등장 (페이즈 2 진입).
      //   풍선 풀 가득 차 있으면 무시. infected 트리거와 동일한 경로.
      kb.on('keydown-Z', () => this.debugSpawnBubble());
      // 게임: [M] 디버그 — 변이 안 된 NEUTROPHIL 1마리 무작위 선정 → 무작위 변이 적용.
      //   페이즈 2 거치지 않고 즉시 변이 → Stage 11~13 페이즈 1 동작 검증용.
      kb.on('keydown-M', () => this.debugRandomMutation());
      // 게임: [ESC] / [S] 컷신 진행 중이면 스킵 → placing 으로 전환. [S] 는 직관적 alias.
      kb.on('keydown-ESC', () => {
        if (this.phase === 'cutscene') this.endCutscene();
      });
      kb.on('keydown-S', () => {
        if (this.phase === 'cutscene') this.endCutscene();
      });
      // 게임: [X] 디버그 — 대식세포 1마리 추가. 영역은 다음 프레임 시스템이 자동 재계산
      //   (N마리면 화면 N등분 → 새로 추가하면 기존 영역도 줄어듦).
      kb.on('keydown-X', () => this.debugSpawnMacrophage());
      // 게임: [I] 페이즈 2 인터렉션 모드 토글. 디폴트 관전, 토글 시 개입.
      kb.on('keydown-I', () => {
        this.interactive = !this.interactive;
        console.log('[mode]', this.interactive ? 'INTERACTIVE' : 'OBSERVE');
      });
      // 게임: [H] 상단 디버그 텍스트 4종 ON/OFF.
      //   hudText / fpsText / controlsText / debugHud — 일괄 visible 토글.
      //   stageHudText (게임플레이 카운트다운) 는 영향 없음.
      kb.on('keydown-H', () => this.toggleDebugVisible());
    }
  }

  // 게임: 상단 디버그 텍스트 일괄 토글. 게임플레이 HUD (스테이지 카운트다운) 는 제외.
  private toggleDebugVisible(): void {
    this.debugVisible = !this.debugVisible;
    this.applyDebugVisible();
  }

  // 게임: debugVisible 값을 4개 텍스트에 일괄 반영. ?mobile 초기 OFF 도 이걸로.
  private applyDebugVisible(): void {
    this.hudText.setVisible(this.debugVisible);
    this.fpsText.setVisible(this.debugVisible);
    this.controlsText.setVisible(this.debugVisible);
    this.debugHud.setVisible(this.debugVisible);
  }

  // 게임: running phase 의 짧은 탭 — 풍선 영역이면 (개입 모드) 쉴드, 아니면 충격파.
  //   pointerdown (데스크탑) 또는 pointerup swipe 미달 (모바일) 시 호출.
  //   충격파 발사 성공 시 shockwaveCounter ++. waitForShockwaves step 종료 조건에 사용.
  private handleRunningTap(x: number, y: number): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (this.isPointInBubble(x, y, b)) {
        if (this.interactive) this.tryActivateBubbleShield(b);
        return;
      }
    }
    if (this.shockwaveSystem.trySpawn(x, y, this.gameTime)) {
      this.shockwaveCounter++;
    }
  }

  // 게임: cutscene 중 짧은 탭의 분기 — 현재 step 타입에 따라 다른 동작.
  //   narration → handleCutsceneClick (다음 라인/step)
  //   waitForShockwaves → handleRunningTap (충격파 발사)
  //   그 외 (control/spawn/pause/waitFor/...) → 무시 (자동 진행만)
  private handleCutsceneTap(x: number, y: number): void {
    const step = this.cutsceneSteps[this.cutsceneStepIndex];
    if (!step) return;
    if (step.type === 'narration' || step.type === 'warning') this.handleCutsceneClick();
    else if (step.type === 'waitForShockwaves') this.handleRunningTap(x, y);
  }

  // 게임: 속도 단계 변경 (1× / 2× / 4×). delta=+1 = 한 단계 ↑, -1 = ↓. 경계 clamp.
  //   모바일 swipe / 키 [1/2/3] 양쪽에서 사용 가능 (현재는 swipe 만).
  private bumpSpeed(delta: number): void {
    const STEPS = [1, 2, 4];
    const cur = STEPS.indexOf(this.speedMultiplier);
    const next = Math.max(0, Math.min(STEPS.length - 1, (cur < 0 ? 0 : cur) + delta));
    this.speedMultiplier = STEPS[next];
  }

  // 게임: 게임에 실제로 사용할 화면 높이. 하단 스킬 바 + (모바일) URL 바 영역 차감.
  //   bounds / spawn 영역 / 대식세포 floor 모두 이 값 사용.
  private effectiveHeight(): number {
    return this.scale.height - (this.isMobile ? BOTTOM_RESERVE_MOBILE : 0) - SKILL_BAR_HEIGHT;
  }

  // 게임: [X] 디버그 — 대식세포 1마리 추가. 무작위 X 위치, 바닥 Y 강제.
  //   MacrophageSystem.update 가 다음 프레임에 영역 재계산 (현재 x 기준 정렬 후 등분).
  //   기존 대식세포의 zone 도 좁아짐 — 직접 시험해볼 수 있도록 의도된 동작.
  private debugSpawnMacrophage(): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
    const phase = Math.random() * Math.PI * 2;
    this.macrophageSystem.add(new Macrophage(MACROPHAGE, this.cellRenderer, x, H, phase));
    console.log('[debug X] macrophage +1 → x=', x.toFixed(0), 'total=', this.macrophageSystem.getAll().length);
  }

  // 게임: 디버그용 — 변이 안 된 살아있는 NEUTROPHIL 후보 중 무작위 선정 → 6 변이 중 균등.
  //   다중 변이 정책: 이미 변이된 호중구는 후보 제외 (mutation === null 만).
  private debugRandomMutation(): void {
    const KINDS: MutationKind[] = ['zombie', 'cancer', 'corruption', 'hyperactive', 'paralysis', 'chaos'];
    const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
    this.debugApplyMutation(kind);
  }

  // 게임: 디버그용 — 특정 종류 변이 적용. 변이 안 된 살아있는 NEUTROPHIL 무작위 선정.
  //   Shift+1~6 단축키 + [M] 무작위 가 공통 호출. 후보 없으면 skip.
  private debugApplyMutation(kind: MutationKind): void {
    const candidates = this.whiteCellBehavior
      .getAlive()
      .filter((c) => c.dnaKind === 'NEUTROPHIL' && c.mutation === null);
    if (candidates.length === 0) {
      console.log('[debug mutation]', kind, '— no eligible NEUTROPHIL');
      return;
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    target.setDna(applyMutation(target.dna, kind));
    target.setMutation(kind);
    if (kind === 'cancer') target.beginCancerDivide(this.gameTime);
    if (kind === 'corruption') target.beginCorruption(this.gameTime);
    if (kind === 'hyperactive') target.beginHyperactive(this.gameTime);
    if (kind === 'paralysis') target.beginParalysis(this.gameTime);
    console.log('[debug mutation]', kind, '→ host at', target.x.toFixed(0), target.y.toFixed(0));
  }

  // ==================== 컷신 시스템 (Session 21) ====================

  // 게임: 컷신 시작 — phase='cutscene' + 첫 step 셋업 + UI 생성.
  private beginCutscene(): void {
    this.phase = 'cutscene';
    this.cutsceneStepIndex = 0;
    this.cutsceneLineIndex = 0;
    this.cutsceneWordIndex = 0;
    this.cutsceneWordTimer = 0;
    this.cutsceneLinePause = 0;
    this.cutsceneAwaitingClick = false;
    this.cutsceneActionTimer = 0;
    this.cutsceneSpawnDone = 0;
    this.createCutsceneUI();
    console.log('[cutscene] begin, steps=', this.cutsceneSteps.length);
    this.applyCutsceneStep();
  }

  // 게임: 컷신 UI 생성 — 화면 위쪽에 텍스트 박스 (둥근 사각형 배경 + 텍스트 + 클릭 힌트).
  //   레이아웃: 좌우 마진 30, 박스 높이 260 (텍스트 5~6 라인 + 여백), 상단 18% 위치.
  //   위쪽 배치 = 아래쪽 객체 (spawn 되는 호중구/세균/영양분) 가 텍스트 박스 가려지지 X.
  private createCutsceneUI(): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const margin = 30;
    const boxH = 260;
    const boxX = margin;
    const boxY = Math.round(H * 0.18);
    const boxW = W - margin * 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.75);
    bg.fillRoundedRect(boxX, boxY, boxW, boxH, 16);
    bg.lineStyle(2, 0x88ccff, 0.6);
    bg.strokeRoundedRect(boxX, boxY, boxW, boxH, 16);
    bg.setDepth(BUBBLE_DEPTH + 20);
    this.cutsceneUiBg = bg;

    const textX = W / 2;
    const textY = boxY + boxH / 2;
    const text = this.add.text(textX, textY, '', {
      color: '#ffffff',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '20px',
      align: 'center',
      wordWrap: { width: boxW - 40 },
      lineSpacing: 6,
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(BUBBLE_DEPTH + 21);
    this.cutsceneUiText = text;
    this.cutsceneTextBaseX = textX;
    this.cutsceneTextBaseY = textY;

    const hint = this.add.text(boxX + boxW - 24, boxY + boxH - 16, '▼ 클릭', {
      color: '#88ccff',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
    });
    hint.setOrigin(1, 1);
    hint.setDepth(BUBBLE_DEPTH + 21);
    hint.setAlpha(0);
    this.cutsceneUiHint = hint;
  }

  // 게임: 컷신 UI 제거 — endCutscene 시 호출.
  private destroyCutsceneUI(): void {
    this.cutsceneUiBg?.destroy();
    this.cutsceneUiText?.destroy();
    this.cutsceneUiHint?.destroy();
    this.cutsceneUiBg = null;
    this.cutsceneUiText = null;
    this.cutsceneUiHint = null;
  }

  // 게임: 컷신 종료 — UI 제거 + EntityRegistry 디폴트 복귀.
  //   cutsceneIsStageIntro 가 false (CUTSCENE_INTRO 종료) 면 stage flow 시작.
  //   true (stage.intro 종료) 면 본게임 진입 (setup 실행 + placement).
  private endCutscene(): void {
    if (this.phase !== 'cutscene') return;
    console.log('[cutscene] end', this.cutsceneIsStageIntro ? '(stage intro)' : '(global intro)');
    // 게임: sentinel — 다음 update 의 updateCutscene 이 early return 하도록.
    //   showStageTitle 이 2.5s tween 동안 phase 가 여전히 'cutscene' 인데,
    //   step 'end' 자리에 머물러 매 프레임 endCutscene 가 재호출되어 startStageFlow 가
    //   반복 → stage 타이틀과 stage.intro UI 가 중첩으로 쌓이는 문제 차단.
    this.cutsceneSteps = [];
    this.cutsceneStepIndex = 0;
    this.destroyCutsceneUI();
    this.entityRegistry.reset();
    this.bacteriaBehavior.frozen = false;  // legacy flag — 다음 정리 단계에 제거.
    this.nutrientSystem.setSpawnBox(null);
    this.nutrientSystem.frozen = false;
    this.nutrientSystem.respawnDelayMul = 1;
    this.nutrientSystem.enableAll();
    this.nutrientRegenRule = null;
    if (this.cutsceneIsStageIntro) {
      // stage.intro 종료 → 본게임 진입.
      this.populateStageStart();
      this.beginNextPlacement(this.scale.width, this.scale.height);
    } else {
      // CUTSCENE_INTRO 종료 → entity 정리 (대본 마지막에 clear() 없어도 안전) → stage 흐름.
      //   직전 이벤트 (충격파 단계 등) 의 entity 가 본게임에 중복으로 넘어가는 문제 방지.
      //   stage.intro 또는 본게임의 populateStageStart 가 깨끗한 상태에서 spawn.
      this.applyCutsceneClear();
      this.startStageFlow();
    }
  }

  // 게임: 스테이지 진입 흐름 — 타이틀 표시 → stage.intro 컷신 → 본게임.
  //   skipIntro 경로 (다음 스테이지 진입) + CUTSCENE_INTRO 종료 경로 양쪽에서 호출됨.
  private startStageFlow(): void {
    this.showStageTitle(() => {
      if (this.currentStage.intro.length > 0) {
        // stage.intro 가 있으면 cutscene runner 로 재사용.
        this.cutsceneSteps = this.currentStage.intro;
        this.cutsceneIsStageIntro = true;
        this.beginCutscene();
      } else {
        // intro 없는 스테이지 — 즉시 본게임.
        this.populateStageStart();
        this.beginNextPlacement(this.scale.width, this.scale.height);
      }
    });
  }

  // 게임: 스테이지 타이틀 풀스크린 표시 — 페이드인 0.5s / 유지 1.5s / 페이드아웃 0.5s.
  //   완료 시 onComplete 호출. tween 사용 — sim 정지 무관 (TweenManager 가 update 외부에서 동작).
  private showStageTitle(onComplete: () => void): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const text = this.add.text(
      W / 2, H / 2,
      `STAGE ${this.currentStageIndex + 1}\n${this.currentStage.title}`,
      {
        color: '#ffe17a',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '48px',
        fontStyle: 'bold',
        align: 'center',
        stroke: '#1a0a00',
        strokeThickness: 6,
        lineSpacing: 12,
      },
    );
    text.setOrigin(0.5, 0.5);
    text.setDepth(BUBBLE_DEPTH + 30);
    text.setAlpha(0);
    this.tweens.add({
      targets: text,
      alpha: 1,
      duration: 500,
      onComplete: () => {
        this.time.delayedCall(1500, () => {
          this.tweens.add({
            targets: text,
            alpha: 0,
            duration: 500,
            onComplete: () => {
              text.destroy();
              onComplete();
            },
          });
        });
      },
    });
  }

  // 게임: 스테이지 시작 spawn — currentStage.setup 스크립트 일괄 실행 (Session 22).
  //   각 CutsceneStep 을 즉시 실행 (timer 없음). 지원: spawn / nutrientRegen / evolveCommander / control.
  //   narration / pause / waitFor 는 setup 에선 의미 없어 skip.
  //   먼저 applyCutsceneClear() 호출 — 컷신 / 이전 스테이지 잔존 개체 모두 정리 후 깨끗한 상태에서 spawn.
  private populateStageStart(): void {
    this.applyCutsceneClear();
    // 게임: stage 카운터 / wave 인덱스도 깨끗하게 (재시작 / 다음 스테이지 둘 다 0 부터).
    this.bacteriaBehavior.resetStageCounters();
    this.nextWaveIndex = 0;
    this.stageStartTime = this.gameTime;
    for (const step of this.currentStage.setup) {
      this.runStageStep(step);
    }
    // 게임: 특전 — T세포/B세포 초반 자동 등장 (place 와 별개, 모든 스테이지 적용).
    //   누적 count 만큼 화면 무작위 위치에 spawn.
    const perk = getPerkState();
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const randPos = (): [number, number] => [
      SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2),
      SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2),
    ];
    for (let i = 0; i < perk.tcellCount; i++) {
      const [x, y] = randPos();
      this.whiteCellBehavior.spawn(TCELL, x, y, Math.random() * Math.PI * 2);
    }
    for (let i = 0; i < perk.bcellCount; i++) {
      const [x, y] = randPos();
      this.whiteCellBehavior.spawn(BCELL, x, y, Math.random() * Math.PI * 2);
    }
  }

  // 게임: setup / wave 의 step 즉시 실행. cutscene runner 와 별개 — timer/UI 없이 효과만 적용.
  //   step.kind 별 분기. 일부 step (narration / waitFor / pause) 은 본게임 흐름에 안 맞아 skip.
  private runStageStep(step: CutsceneStep): void {
    if (step.type === 'spawn') {
      this.runSpawnStep(step);
    } else if (step.type === 'control') {
      this.entityRegistry.set(step.kind, step.set);
    } else if (step.type === 'nutrientRegen') {
      // 게임: 스테이지 setup/wave — 중앙 기준 리젠 (centroid 쏠림 방지).
      this.applyNutrientRegen(step.options, true);
    } else if (step.type === 'evolveCommander') {
      const remainingDelay = Math.max(0, COMMANDER_EVOLUTION_DELAY - step.afterSeconds);
      this.teamSystem.requeueDeathRecord(this.gameTime - remainingDelay);
    } else if (step.type === 'clear') {
      this.applyCutsceneClear();
    } else if (step.type === 'place') {
      // 게임: placementQueue 에 등록. 컷신/stage setup 종료 시 beginNextPlacement 가 일괄 처리.
      this.enqueuePlacement(step.kind, step.label);
    }
    // narration / pause / waitFor / waitForShockwaves / end → setup/wave 에선 무시.
  }

  // 게임: EntityKind → 배치용 DNA 매핑. place() step 처리 시 placementQueue 에 push.
  //   배치 가능한 종 (DNA 보유 + 사용자가 클릭으로 위치 선택 의미 있는 것) 만 매핑.
  //   외 종 (영양분/항체/풍선 등) 은 무시 (console.warn).
  private enqueuePlacement(kind: import('../domain/entityControl').EntityKind, label: string): void {
    let dna: DNA | null = null;
    switch (kind) {
      case 'neutrophil':        dna = NEUTROPHIL; break;
      case 'neutrophilSuper':   dna = NEUTROPHIL_SUPER; break;
      case 'nk':                dna = NK_CELL; break;
      case 'bcell':             dna = BCELL; break;
      case 'tcell':             dna = TCELL; break;
      case 'bacteria':          dna = BACTERIA_A; break;
      case 'bacteriaCommander': dna = BACTERIA_COMMANDER; break;
      case 'macrophage': case 'nutrient': case 'antibody': case 'bubble':
        console.warn('[place] not supported for kind:', kind);
        return;
    }
    if (dna !== null) this.placementQueue.push({ dna, label });
  }

  // 게임: spawn step 즉시 실행 — sparkle / interval 없이 count 개를 한꺼번에 spawn.
  //   setup 에서 호출 (게임 시작 시점) — 컷신 runner 의 점진 spawn 과 다른 경로.
  private runSpawnStep(step: { type: 'spawn'; kind: import('../domain/entityControl').EntityKind; count: number; area?: import('../cutscenes/types').SpawnArea }): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const area = step.area ?? {};
    const cx = area.cx ?? W / 2;
    const cy = area.cy ?? H / 2;
    const spread = area.spread ?? 0;
    const infectedChance = area.infectedChance ?? 0;
    for (let i = 0; i < step.count; i++) {
      const x = cx + (Math.random() * 2 - 1) * spread;
      const y = cy + (Math.random() * 2 - 1) * spread;
      const infected = infectedChance > 0 && Math.random() < infectedChance;
      this.spawnByEntityKind(step.kind, x, y, { infected });
    }
  }

  // 게임: 현재 step 진입 처리. step 타입별 상태 초기화.
  //   narration: UI 표시 + 단어 타이핑 시작. action: UI 숨김 + kind 별 spawn/sim 셋업.
  private applyCutsceneStep(): void {
    if (this.cutsceneStepIndex >= this.cutsceneSteps.length) {
      this.endCutscene();
      return;
    }
    const step = this.cutsceneSteps[this.cutsceneStepIndex];
    if (step.type === 'end') {
      this.endCutscene();
      return;
    }
    if (step.type === 'narration' || step.type === 'warning') {
      this.cutsceneLineIndex = 0;
      this.cutsceneWordIndex = 0;
      this.cutsceneWordTimer = CUTSCENE_WORD_INTERVAL;
      this.cutsceneLinePause = 0;
      this.cutsceneAwaitingClick = false;
      this.showCutsceneUI();
      this.cutsceneUiText?.setText('');
      this.cutsceneUiHint?.setAlpha(0);
      // 게임: narration ↔ warning 전환 시 색/굵기/위치 복원. warning 은 jitter 가 매 프레임 갱신.
      if (this.cutsceneUiText) {
        if (step.type === 'warning') {
          this.cutsceneUiText.setColor('#ff5566');
          this.cutsceneUiText.setFontStyle('bold');
        } else {
          this.cutsceneUiText.setColor('#ffffff');
          this.cutsceneUiText.setFontStyle('normal');
          this.cutsceneUiText.x = this.cutsceneTextBaseX;
          this.cutsceneUiText.y = this.cutsceneTextBaseY;
        }
      }
    } else {
      // 게임: control / spawn / pause / waitFor / waitForShockwaves / ... — 공통 셋업.
      //   sim 활성/정지는 control('xxx', { frozen }) 으로 대본이 직접 제어.
      this.cutsceneActionTimer = 0;
      this.cutsceneSpawnDone = 0;
      this.cutsceneSpawnPositions = [];
      this.cutsceneSparkleStartTime = 0;
      // 게임: 이전 step 의 sparkle gfx 가 살아있다면 정리 (방어적).
      this.cutsceneSparkleGfx?.destroy();
      this.cutsceneSparkleGfx = null;
      // 게임: 충격파 카운터 reset — waitForShockwaves step 진입 시 새로 세기 시작.
      this.shockwaveCounter = 0;
      // 게임: waitForBacteriaKilled baseline 갱신 — step 진입 시점 stageKilled 를 기록.
      this.cutsceneBacteriaKilledBaseline = this.bacteriaBehavior.getStageKilled();
      // 게임: waitForMacrophageProductions baseline 갱신.
      this.cutsceneMacrophageProductionBaseline = this.macrophageSystem.getProductionCount();
      this.cutsceneAwaitingClick = false;
      this.hideCutsceneUI();
    }
  }

  // 게임: 컷신 UI visible/hidden 토글 — ACTION 진입 시 hide, narration 시 show.
  private hideCutsceneUI(): void {
    this.cutsceneUiBg?.setAlpha(0);
    this.cutsceneUiText?.setAlpha(0);
    this.cutsceneUiHint?.setAlpha(0);
  }
  private showCutsceneUI(): void {
    this.cutsceneUiBg?.setAlpha(1);
    this.cutsceneUiText?.setAlpha(1);
    this.cutsceneUiHint?.setAlpha(0);  // hint 는 라인 완료 후 별도 표시
  }

  // 게임: 단계 6 — applyCutsceneAction 제거. intro-script 가 선언적 step 으로 마이그레이션됨.

  // 게임: 매 프레임 컷신 진행 — dt 기준. real time (Phaser delta) 사용 (gameTime 정지 무관).
  private updateCutscene(dtReal: number): void {
    if (this.cutsceneStepIndex >= this.cutsceneSteps.length) return;
    const step = this.cutsceneSteps[this.cutsceneStepIndex];

    if (step.type === 'narration') {
      this.updateCutsceneNarration(step.lines, dtReal);
    } else if (step.type === 'warning') {
      this.updateCutsceneNarration(step.lines, dtReal);
      // 게임: warning 중에는 매 프레임 ±1.5px 무작위 jitter — "흔들리는 경고" 톤.
      //   awaitingClick 동안도 계속 흔들림 (위협감 유지). 다음 step 진입 시 base 로 복원됨.
      if (this.cutsceneUiText) {
        const amp = 1.5;
        this.cutsceneUiText.x = this.cutsceneTextBaseX + (Math.random() * 2 - 1) * amp;
        this.cutsceneUiText.y = this.cutsceneTextBaseY + (Math.random() * 2 - 1) * amp;
      }
    } else if (step.type === 'control') {
      // 게임: control step — registry 갱신 즉시 (1프레임) 후 다음 step. timer 없음.
      this.entityRegistry.set(step.kind, step.set);
      this.advanceCutsceneStep();
    } else if (step.type === 'spawn') {
      // 게임: spawn step — area.interval 0 면 일괄 spawn 즉시 다음, >0 면 순차 (timer).
      this.updateCutsceneSpawn(step, dtReal);
    } else if (step.type === 'pause') {
      // 게임: pause step — seconds 만큼 timer.
      this.cutsceneActionTimer += dtReal;
      if (this.cutsceneActionTimer >= step.seconds) this.advanceCutsceneStep();
    } else if (step.type === 'waitFor') {
      // 게임: waitFor step — 조건 충족 OR maxSeconds 도달 시 advance.
      this.cutsceneActionTimer += dtReal;
      if (this.evalWaitCondition(step.condition) || this.cutsceneActionTimer >= step.maxSeconds) {
        this.advanceCutsceneStep();
      }
    } else if (step.type === 'waitForShockwaves') {
      // 게임: 사용자가 충격파 N번 발사 OR maxSeconds 도달 시 advance.
      //   shockwaveCounter 는 step 진입 시 0 reset 됨 (applyCutsceneStep else 분기).
      this.cutsceneActionTimer += dtReal;
      if (this.shockwaveCounter >= step.count || this.cutsceneActionTimer >= step.maxSeconds) {
        this.advanceCutsceneStep();
      }
    } else if (step.type === 'waitForBacteriaKilled') {
      // 게임: step 진입 후 추가 사망한 세균 수 >= count OR maxSeconds 도달 시 advance.
      //   baseline 은 step 진입 시 (applyCutsceneStep else 분기) 에 set.
      this.cutsceneActionTimer += dtReal;
      const killed = this.bacteriaBehavior.getStageKilled() - this.cutsceneBacteriaKilledBaseline;
      if (killed >= step.count || this.cutsceneActionTimer >= step.maxSeconds) {
        this.advanceCutsceneStep();
      }
    } else if (step.type === 'waitForMacrophageProductions') {
      // 게임: step 진입 후 대식세포 호중구 생산 횟수 >= count OR maxSeconds 도달 시 advance.
      this.cutsceneActionTimer += dtReal;
      const produced = this.macrophageSystem.getProductionCount() - this.cutsceneMacrophageProductionBaseline;
      if (produced >= step.count || this.cutsceneActionTimer >= step.maxSeconds) {
        this.advanceCutsceneStep();
      }
    } else if (step.type === 'evolveCommander') {
      // 게임: 진화 트리거 — fake deathTime 을 backdate 하여 COMMANDER_EVOLUTION_DELAY 카운트다운.
      //   deathTime = gameTime - (DELAY - afterSeconds) → 정확히 afterSeconds 후 expired.
      //   afterSeconds >= DELAY 면 즉시 만료 (다음 evolveCommanders 호출에 변환).
      const remainingDelay = Math.max(0, COMMANDER_EVOLUTION_DELAY - step.afterSeconds);
      this.teamSystem.requeueDeathRecord(this.gameTime - remainingDelay);
      this.advanceCutsceneStep();
    } else if (step.type === 'nutrientRegen') {
      this.applyNutrientRegen(step.options);
      this.advanceCutsceneStep();
    } else if (step.type === 'clear') {
      this.applyCutsceneClear();
      this.advanceCutsceneStep();
    } else if (step.type === 'place') {
      // 게임: placementQueue 에 등록 후 즉시 advance — 컷신 흐름 막지 않음.
      //   컷신 종료 시 beginNextPlacement 가 큐를 순차 처리.
      this.enqueuePlacement(step.kind, step.label);
      this.advanceCutsceneStep();
    } else {
      this.endCutscene();
    }
  }

  // 게임: narration 진행 — 라인 안 단어별 타이핑, 라인 끝 pause, 모든 라인 표시 후 클릭 대기.
  private updateCutsceneNarration(lines: string[], dtReal: number): void {
    if (this.cutsceneAwaitingClick) return;
    // 게임: 라인 사이 pause 진행 중이면 timer 만 감소.
    if (this.cutsceneLinePause > 0) {
      this.cutsceneLinePause -= dtReal;
      if (this.cutsceneLinePause <= 0) {
        this.cutsceneLineIndex++;
        this.cutsceneWordIndex = 0;
        this.cutsceneWordTimer = CUTSCENE_WORD_INTERVAL;
      }
      return;
    }
    // 게임: 다음 단어 추가 timer.
    this.cutsceneWordTimer -= dtReal;
    if (this.cutsceneWordTimer > 0) return;
    const lineText = lines[this.cutsceneLineIndex];
    const words = lineText.split(/\s+/);
    this.cutsceneWordIndex++;
    if (this.cutsceneWordIndex >= words.length) {
      // 게임: 라인 완료. 다음 라인 또는 마지막이면 클릭 대기.
      this.renderCutsceneNarration(lines);
      if (this.cutsceneLineIndex >= lines.length - 1) {
        this.cutsceneAwaitingClick = true;
        this.cutsceneUiHint?.setAlpha(1);
      } else {
        this.cutsceneLinePause = CUTSCENE_LINE_PAUSE;
      }
      return;
    }
    this.cutsceneWordTimer = CUTSCENE_WORD_INTERVAL;
    this.renderCutsceneNarration(lines);
  }

  // 게임: 현재 narration 상태를 텍스트 박스에 그림. 완료된 라인 + 진행 중인 라인의 N 단어.
  private renderCutsceneNarration(lines: string[]): void {
    if (!this.cutsceneUiText) return;
    const out: string[] = [];
    for (let i = 0; i < this.cutsceneLineIndex; i++) out.push(lines[i]);
    const currentLine = lines[this.cutsceneLineIndex];
    if (currentLine !== undefined) {
      const words = currentLine.split(/\s+/);
      const shown = words.slice(0, this.cutsceneWordIndex).join(' ');
      if (shown.length > 0) out.push(shown);
    }
    this.cutsceneUiText.setText(out.join('\n'));
  }

  // 게임: 단계 6 — updateCutsceneAction 제거. step 'action' 타입은 더 이상 사용 X.

  // 게임: 선언적 spawn step 처리 (단계 5 + sparkle 복원).
  //   interval=0 (생략) → 첫 호출에 count 모두 일괄 spawn.
  //   interval>0 → 매 interval 마다 1개 spawn, count 도달 시 sparkle phase 또는 advance.
  //   sparkleSeconds>0 → spawn 완료 후 그 시간만큼 노란 원 펄스 + step 머묾 → advance.
  private updateCutsceneSpawn(
    step: { type: 'spawn'; kind: import('../domain/entityControl').EntityKind; count: number; area?: import('../cutscenes/types').SpawnArea },
    dtReal: number,
  ): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const area = step.area ?? {};
    const cx = area.cx ?? W / 2;
    const cy = area.cy ?? H / 2;
    const spread = area.spread ?? 0;
    const interval = area.interval ?? 0;
    const sparkleSeconds = area.sparkleSeconds ?? 0;
    const infectedChance = area.infectedChance ?? 0;

    this.cutsceneActionTimer += dtReal;

    // 게임: phase 1 — spawn 진행 (아직 count 미달).
    if (this.cutsceneSpawnDone < step.count) {
      if (interval <= 0) {
        // 일괄 spawn — 한 번에 count 모두 처리.
        for (let i = 0; i < step.count; i++) {
          const x = cx + (Math.random() * 2 - 1) * spread;
          const y = cy + (Math.random() * 2 - 1) * spread;
          const infected = infectedChance > 0 && Math.random() < infectedChance;
          this.spawnByEntityKind(step.kind, x, y, { infected });
          this.cutsceneSpawnPositions.push({ x, y });
        }
        this.cutsceneSpawnDone = step.count;
      } else {
        // 순차 spawn — cutsceneActionTimer 가 (done+1)*interval 도달 시 1개씩.
        while (this.cutsceneSpawnDone < step.count
            && this.cutsceneActionTimer >= (this.cutsceneSpawnDone + 1) * interval) {
          const x = cx + (Math.random() * 2 - 1) * spread;
          const y = cy + (Math.random() * 2 - 1) * spread;
          const infected = infectedChance > 0 && Math.random() < infectedChance;
          this.spawnByEntityKind(step.kind, x, y, { infected });
          this.cutsceneSpawnPositions.push({ x, y });
          this.cutsceneSpawnDone++;
        }
      }
      // 게임: 방금 count 도달했으면 sparkle 시작 시각 기록 (다음 프레임부터 phase 2).
      if (this.cutsceneSpawnDone >= step.count) {
        if (sparkleSeconds > 0) {
          this.cutsceneSparkleStartTime = this.cutsceneActionTimer;
          this.cutsceneSparkleGfx = this.add.graphics();
          this.cutsceneSparkleGfx.setDepth(BUBBLE_DEPTH + 19);
        } else {
          this.advanceCutsceneStep();
        }
      }
      return;
    }

    // 게임: phase 2 — sparkle (sparkleSeconds > 0 인 경우). count 모두 spawn 됐고 sparkle 진행 중.
    const elapsed = this.cutsceneActionTimer - this.cutsceneSparkleStartTime;
    const tt = Math.min(1, elapsed / sparkleSeconds);
    const gfx = this.cutsceneSparkleGfx;
    if (gfx) {
      gfx.clear();
      const r = 8 + tt * 24;          // 반지름 8 → 32px 확장
      const alpha = 1 - tt;            // alpha 1 → 0 페이드
      gfx.lineStyle(2, 0xffff88, alpha);
      for (const p of this.cutsceneSpawnPositions) gfx.strokeCircle(p.x, p.y, r);
    }
    if (tt >= 1) {
      gfx?.destroy();
      this.cutsceneSparkleGfx = null;
      this.advanceCutsceneStep();
    }
  }

  // 게임: EntityKind → 해당 시스템의 spawn 메서드 dispatch.
  //   각 종은 BloodScene 의 spawnNeutrophils/Bacteria 같은 helper 와 동일한 방식.
  //   bubble / nutrient / antibody 는 별도 처리 (각 시스템에 직접).
  //   options.infected: bacteria/bacteriaCommander 에만 의미 — spawn 후 setInfected 호출.
  private spawnByEntityKind(
    kind: import('../domain/entityControl').EntityKind,
    x: number,
    y: number,
    options?: { infected?: boolean },
  ): void {
    const phase = Math.random() * Math.PI * 2;
    switch (kind) {
      case 'neutrophil':       this.whiteCellBehavior.spawn(NEUTROPHIL, x, y, phase); return;
      case 'neutrophilSuper':  this.whiteCellBehavior.spawn(NEUTROPHIL_SUPER, x, y, phase); return;
      case 'nk':               this.whiteCellBehavior.spawn(NK_CELL, x, y, phase); return;
      case 'bcell':            this.whiteCellBehavior.spawn(BCELL, x, y, phase); return;
      case 'tcell':            this.whiteCellBehavior.spawn(TCELL, x, y, phase); return;
      case 'bacteria': {
        const b = this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
        if (b !== null && options?.infected) b.setInfected();
        return;
      }
      case 'bacteriaCommander': {
        const b = this.bacteriaBehavior.spawn(BACTERIA_COMMANDER, x, y, phase);
        if (b !== null && options?.infected) b.setInfected();
        return;
      }
      case 'macrophage': {
        // 게임: 대식세포는 바닥 고정 (y 무시 — 시스템이 floorY 강제).
        const m = new Macrophage(MACROPHAGE, this.cellRenderer, x, this.effectiveHeight(), phase);
        this.macrophageSystem.add(m);
        return;
      }
      case 'nutrient': {
        // 게임: 영양분은 슬롯 인덱스 필요 — 비활성 슬롯 찾아 활성화. 없으면 skip.
        const slots = this.nutrientSystem.getAllSlots();
        for (let i = 0; i < slots.length; i++) {
          if (!slots[i].active) { this.nutrientSystem.spawnAt(i, x, y); return; }
        }
        return;
      }
      case 'antibody':
      case 'bubble':
        // 게임: 컷신에서 직접 spawn 안 함 — B세포 발사 / 풍선 등장은 게임 로직.
        console.warn('[cutscene] spawn kind not supported via spawn step:', kind);
        return;
    }
  }

  // 게임: clear step 처리 — 모든 entity 정리 (clean slate). registry 는 유지.
  //   대상: 백혈구·세균 (살아있음/시체 모두), 대식세포, 영양분, 항체, 페이즈 2 풍선.
  //   handle destroy + 풀 비움. 다음 step 의 spawn 이 즉시 가능.
  private applyCutsceneClear(): void {
    // 백혈구 — 모두 isAbsorbed 후 즉시 정리.
    for (const c of this.whiteCellBehavior.getAll()) c.isAbsorbed = true;
    this.whiteCellBehavior.removeAbsorbed();
    // 세균 — 동일.
    for (const b of this.bacteriaBehavior.getAll()) b.isAbsorbed = true;
    this.bacteriaBehavior.removeAbsorbed();
    // 대식세포 — 별도 클래스. 전용 clearAll.
    this.macrophageSystem.clearAll();
    // 영양분 — 모두 비활성 (위치는 보존, active=false). 다음 spawnAt 으로 재활성 가능.
    this.nutrientSystem.disableAll();
    // 항체 — isAbsorbed 마킹. AntibodySystem.update 가 다음 프레임에 청소.
    for (const ab of this.antibodySystem.getAll()) ab.isAbsorbed = true;
    // 페이즈 2 풍선 — 모두 close (페이드 아웃 후 destroy).
    for (const bubble of [...this.bubbles]) this.closeBubble(bubble);
  }

  // 게임: nutrientRegen step 처리 — 영양분 부활 박스 set + frozen 해제 + 초기 활성화.
  //   options.cx/cy 생략 시:
  //     - centerOnScreen=true (스테이지 setup/wave): 플레이 영역 중앙 고정.
  //         centroid 기본값은 spawn 무작위 편차로 박스가 한쪽 구석(예: 좌상단)에 쏠려
  //         영양분이 가장자리에만 리젠되는 문제가 있어, 스테이지에선 중앙 기준으로 통일.
  //     - centerOnScreen=false (컷신 reinforcement): 살아있는 백혈구 centroid (없으면 중앙).
  //         "세균이 백혈구 영역에 들어와야 먹음" 시연 의도 — 컷신은 기존 동작 유지.
  private applyNutrientRegen(
    options: import('../cutscenes/types').NutrientRegenOptions,
    centerOnScreen = false,
  ): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const half = options.half ?? 80;
    const initialCount = options.initialCount ?? 6;
    let cx = options.cx;
    let cy = options.cy;
    if (cx === undefined || cy === undefined) {
      if (centerOnScreen) {
        cx = cx ?? W / 2;
        cy = cy ?? H / 2;
      } else {
        const live = this.whiteCellBehavior.getAlive();
        if (live.length > 0) {
          cx = cx ?? live.reduce((s, c) => s + c.x, 0) / live.length;
          cy = cy ?? live.reduce((s, c) => s + c.y, 0) / live.length;
        } else {
          cx = cx ?? W / 2;
          cy = cy ?? H / 2;
        }
      }
    }
    this.nutrientSystem.setSpawnBox({ cx, cy, half });
    this.nutrientSystem.frozen = false;
    // 게임: registry 도 동기화 (control('nutrient', { ... }) 로 막혀있을 수도 있음).
    this.entityRegistry.set('nutrient', { enabled: true, frozen: false });
    this.nutrientSystem.disableAll();
    for (let i = 0; i < initialCount; i++) {
      const x = cx + (Math.random() * 2 - 1) * half;
      const y = cy + (Math.random() * 2 - 1) * half;
      this.nutrientSystem.spawnAt(i, x, y);
    }
    // 게임: 동적 리젠 조절 규칙 갱신 — set 됐으면 매 프레임 검사 시작, 없으면 reset.
    //   기존 rule 도 함께 reset (다른 nutrientRegen 호출 시 이전 규칙 누적 X).
    this.nutrientRegenRule = options.slowWhenBacteriaAbove ?? null;
    if (this.nutrientRegenRule === null) this.nutrientSystem.respawnDelayMul = 1;
  }

  // 게임: waitFor step 의 condition 평가 — 게임 상태 기반.
  //   호중구류 = NEUTROPHIL + NEUTROPHIL_SUPER + NK_CELL (BCELL/TCELL 제외).
  //   whiteCells 는 살아있는 모든 백혈구 (위 포함 + BCELL/TCELL).
  private evalWaitCondition(condition: WaitCondition): boolean {
    switch (condition) {
      case 'nutrientsConsumed':
        return this.nutrientSystem.getActiveCount() === 0;
      case 'bacteriaEliminated':
        return this.bacteriaBehavior.getAlive().length === 0;
      case 'neutrophilsEliminated': {
        const live = this.whiteCellBehavior.getAlive();
        return live.filter((c) =>
          c.dnaKind === 'NEUTROPHIL' || c.dnaKind === 'NEUTROPHIL_SUPER' || c.dnaKind === 'NK_CELL',
        ).length === 0;
      }
      case 'whiteCellsEliminated':
        return this.whiteCellBehavior.getAlive().length === 0;
    }
  }

  // 게임: 단계 6 — updateCutsceneSpawn* / updateCutsceneReinforcement 제거.
  //   intro-script 가 선언적 control/spawn/pause 로 마이그레이션됨. sparkle 같은 시각 효과는
  //   필요 시 별도 cutscene step 타입 (예: 'effect') 로 추가 가능 — 현재는 단순화.

  // 게임: 다음 step 진행 — index++ + applyCutsceneStep. action 종료 공통.
  private advanceCutsceneStep(): void {
    this.cutsceneStepIndex++;
    this.applyCutsceneStep();
  }

  // 게임: 컷신 클릭 — narration: 진행 중이면 즉시 모두 표시, 완료 시 다음 step.
  //   action: 클릭 무시 (자동 진행). Stage B 에서 skip 옵션 추가 가능.
  private handleCutsceneClick(): void {
    if (this.cutsceneStepIndex >= this.cutsceneSteps.length) return;
    const step = this.cutsceneSteps[this.cutsceneStepIndex];
    if (step.type !== 'narration' && step.type !== 'warning') return;

    if (!this.cutsceneAwaitingClick) {
      // 게임: 즉시 모두 표시 — 모든 라인 펼침.
      const allText = step.lines.join('\n');
      this.cutsceneUiText?.setText(allText);
      this.cutsceneAwaitingClick = true;
      this.cutsceneUiHint?.setAlpha(1);
      return;
    }
    // 게임: 다음 step 진행.
    this.cutsceneStepIndex++;
    this.applyCutsceneStep();
  }

  // ==================== 컷신 시스템 끝 ====================

  // 게임: 다음 placement 슬롯 — 큐 비면 phase='running' 으로 전환.
  //        미리보기 핸들 (반투명 alpha 0.6) 마우스 위치에 생성.
  private beginNextPlacement(W: number, H: number): void {
    if (this.placementQueue.length === 0) {
      this.phase = 'running';
      // 게임: running 진입 시점 = stage 시작. cutscene 동안 진행된 gameTime 을 기준으로 stage 시간 계산.
      this.stageStartTime = this.gameTime;
      this.placementHandle?.destroy();
      this.placementHandle = null;
      this.placementText.setText('');
      return;
    }
    this.phase = 'placing';
    const slot = this.placementQueue[0];
    const startX = this.pointerX || W / 2;
    const startY = this.pointerY || H / 2;
    this.placementHandle?.destroy();
    this.placementHandle = this.cellRenderer.create(slot.dna, startX, startY);
    this.placementHandle.setAlpha(0.6);
    this.placementHandle.setVisualState({ shock: 0, combat: 0, life: 1 });
    this.placementHandle.update(0);
    this.placementText.setText(`${slot.label} 위치를 클릭하세요`);
  }

  // 게임: 사용자가 클릭한 위치에 현재 슬롯의 종족 spawn + 다음 슬롯으로.
  private confirmPlacement(x: number, y: number): void {
    if (this.placementQueue.length === 0) return;
    const slot = this.placementQueue.shift()!;
    const phase = Math.random() * Math.PI * 2;
    if (slot.dna.kind === 'BACTERIA_COMMANDER') {
      this.bacteriaBehavior.spawn(slot.dna, x, y, phase);
    } else {
      // 게임: 호중구류 (TCELL/BCELL/NEUTROPHIL/...) 는 모두 WhiteCell 풀.
      this.whiteCellBehavior.spawn(slot.dna, x, y, phase);
    }
    this.beginNextPlacement(this.scale.width, this.scale.height);
  }

  // 게임: [Z] 디버그 — 살아있는 일반 NEUTROPHIL 무작위 선정 후 풍선 spawn (페이즈 2 진입).
  //   풍선 풀 가득 차 있으면 무시. infected 트리거와 동일한 경로.
  private debugSpawnBubble(): void {
    if (this.phase !== 'running') return;
    if (this.bubbles.length >= BUBBLE_MAX) {
      console.log('[debug Z] bubble pool full');
      return;
    }
    const candidates = this.whiteCellBehavior
      .getAlive()
      .filter((c) => c.dnaKind === 'NEUTROPHIL' && c.mutation === null && !this.isHostingBubble(c));
    if (candidates.length === 0) {
      console.log('[debug Z] no NEUTROPHIL target found');
      return;
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    this.spawnBubble(target);
  }

  // 게임: 매 프레임 — corruption 호중구 소멸 시 다른 NEUTROPHIL 호스트로 풍선 spawn.
  //   pendingCorruptionFinale 은 즉시 false — 재진입 방지. isAbsorbed 는 이미 true.
  //   풍선 풀 가득 차 있으면 조용히 종료 (한 프레임 한 번만).
  private checkCorruptionTrigger(): void {
    if (this.phase !== 'running') return;
    for (const c of this.whiteCellBehavior.getAll()) {
      if (!c.pendingCorruptionFinale) continue;
      c.pendingCorruptionFinale = false;
      if (this.bubbles.length >= BUBBLE_MAX) {
        console.log('[corruption finale] bubble pool full — skip');
        return;
      }
      const candidates = this.whiteCellBehavior
        .getAlive()
        .filter((other) => other !== c && other.dnaKind === 'NEUTROPHIL' && other.mutation === null && !this.isHostingBubble(other));
      if (candidates.length === 0) {
        console.log('[corruption finale] no NEUTROPHIL candidate — skip');
        return;
      }
      const newHost = candidates[Math.floor(Math.random() * candidates.length)];
      console.log('[corruption finale] spawn bubble → host', newHost.x.toFixed(0), newHost.y.toFixed(0));
      this.spawnBubble(newHost);
      return; // 한 프레임 한 번만
    }
  }

  // 게임: hyperactive 변이 폭발 트리거. pendingHyperactiveExplosion=true 인 호중구 위치 기준
  //   반경 200px 내 살아있는 호중구/세균 모두 즉사 (isAbsorbed=true).
  //   본인은 이미 isAbsorbed (WhiteCell.updateAlive 가 set). 다음 cleanupAbsorbed 에 풀에서 제거.
  private checkHyperactiveTrigger(): void {
    for (const c of this.whiteCellBehavior.getAll()) {
      if (!c.pendingHyperactiveExplosion) continue;
      c.pendingHyperactiveExplosion = false;
      const ex = c.x;
      const ey = c.y;
      const r2 = HYPERACTIVE_EXPLOSION_RADIUS * HYPERACTIVE_EXPLOSION_RADIUS;
      let killed = 0;
      for (const other of this.whiteCellBehavior.getAlive()) {
        if (other === c) continue;
        const dx = other.x - ex;
        const dy = other.y - ey;
        if (dx * dx + dy * dy <= r2) { other.isAbsorbed = true; killed++; }
      }
      for (const b of this.bacteriaBehavior.getAlive()) {
        const dx = b.x - ex;
        const dy = b.y - ey;
        if (dx * dx + dy * dy <= r2) { b.isAbsorbed = true; killed++; }
      }
      console.log('[hyperactive explosion] at', ex.toFixed(0), ey.toFixed(0), 'killed', killed);
    }
  }

  // 게임: paralysis 외부 전파 — 변이 호중구가 cycle active 인 동안 매 프레임 인접 정상 호중구에 마비 부여.
  //   1단계 전파만 — 전파된 호중구는 mutation=null 이라 추가 사이클 없음 → 무한 전파 X.
  //   paralyzedUntil = max(기존, t + DURATION) 로 갱신 (이미 마비 중이면 시간만 연장).
  private checkParalysisPropagation(t: number): void {
    const all = this.whiteCellBehavior.getAll();
    const r2 = PARALYSIS_PROPAGATION_RADIUS * PARALYSIS_PROPAGATION_RADIUS;
    for (const src of all) {
      if (src.isDead()) continue;
      if (src.mutation !== 'paralysis') continue;
      if (src.paralysisStartTime === null) continue;
      // 게임: cycle active 검사 — isParalyzed 는 외부 전파도 포함하므로 자기 cycle 만 별도 검사.
      const phase = (t - src.paralysisStartTime) % 3;
      if (phase >= 0.5) continue;
      const until = t + PARALYSIS_PROPAGATION_DURATION;
      for (const tgt of all) {
        if (tgt === src) continue;
        if (tgt.isDead()) continue;
        if (tgt.mutation !== null) continue;
        if (tgt.dnaKind !== 'NEUTROPHIL') continue;
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        if (dx * dx + dy * dy > r2) continue;
        if (until > tgt.paralyzedUntil) tgt.paralyzedUntil = until;
      }
    }
  }

  // 게임: 매 프레임 — infected 세균이 호중구에 죽었으면 그 호중구로 풍선 spawn.
  //   조건: b.isDead + b.isInfected + b.killedByCell 살아있음 + NEUTROPHIL + mutation 없음 + 풀 여유 + 이미 풍선 보유 X.
  //   진입 후 b.isInfected/killedByCell 정리 — 재진입 방지.
  private checkInfectedKillTrigger(): void {
    if (this.phase !== 'running') return;
    for (const b of this.bacteriaBehavior.getAll()) {
      if (!b.isDead()) continue;
      if (!b.isInfected) continue;
      if (b.killedByCell === null) continue;
      const host = b.killedByCell;
      // 게임: 한 번만 트리거. 다음 프레임 재검사 시 무시되도록 즉시 정리.
      b.isInfected = false;
      b.killedByCell = null;
      if (host.isDead() || host.isAbsorbed) continue;
      if (host.dnaKind !== 'NEUTROPHIL') continue;
      if (host.mutation !== null) continue;
      if (this.bubbles.length >= BUBBLE_MAX) {
        console.log('[infected trigger] bubble pool full — skip');
        continue;
      }
      if (this.isHostingBubble(host)) continue;
      console.log('[infected trigger] spawn bubble → host', host.x.toFixed(0), host.y.toFixed(0));
      this.spawnBubble(host);
      return; // 한 프레임 한 번만
    }
  }

  // 게임: 풍선 등장 — host 호중구에 페이즈 2 wave 가 진행되는 화면 우상단 풍선 추가.
  //   외부 sim 정지 X — 매 프레임 updateBubbles 가 풍선 진행. host 사망 시 closeBubble 즉시.
  //   spawn 위치 = 우상단 + (기존 풍선 수 × spacing) 세로 정렬. Stage A 는 BUBBLE_MAX=1 이라 단일.
  private spawnBubble(host: import('../entities/WhiteCell').WhiteCell): void {
    const W = this.scale.width;
    const slot = this.bubbles.length;
    const centerX = W - BUBBLE_MARGIN_RIGHT - BUBBLE_SIZE / 2;
    const centerY = BUBBLE_MARGIN_TOP + BUBBLE_SIZE / 2 + slot * (BUBBLE_SIZE + BUBBLE_SPACING);

    const queue = WAVE_KIND_DISTRIBUTION.slice();
    shuffleInPlace(queue);
    const wave: WaveState = {
      spawnQueue: queue,
      nextSpawnTime: WAVE_FIRST_DELAY,
      hits: 0,
      resolved: false,
      resolvedAt: 0,
      shieldCharges: WAVE_SHIELD_CHARGES,
      shieldActiveUntil: 0,
    };

    // 게임: frame + 컨텐츠 그래픽. 정상 displayList 에 그대로 추가 (Layer 시스템 제거).
    //   모두 alpha=0 시작 — updateBubble 의 페이드 인이 0→1.
    //   setDepth(BUBBLE_DEPTH) — 나중 spawn 된 외부 객체 (호중구/세균 등) 도 풍선 아래로 그림.
    const frameGfx = this.add.graphics();
    frameGfx.setAlpha(0);
    frameGfx.setDepth(BUBBLE_DEPTH);
    const contentsGfx = this.add.graphics();
    contentsGfx.setPosition(centerX, centerY);
    contentsGfx.setAlpha(0);
    contentsGfx.setDepth(BUBBLE_DEPTH + 1);
    // 게임: virusLayer = Container — 풍선 중심 origin. 안에 바이러스 / 쉴드 이펙트 Graphics 추가.
    const virusLayer = this.add.container(centerX, centerY);
    virusLayer.setAlpha(0);
    virusLayer.setDepth(BUBBLE_DEPTH + 2);

    const hudText = this.add.text(centerX, centerY + BUBBLE_SIZE / 2 - 24, '', {
      color: '#fc8',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '11px',
      align: 'center',
    });
    hudText.setOrigin(0.5, 0.5);
    hudText.setAlpha(0);
    hudText.setDepth(BUBBLE_DEPTH + 3);

    // 게임: 결과 텍스트 — wave finalize 후 풍선 중앙에 강조 표시. 큰 폰트 + 외곽선 + 팝 tween.
    //   진행 중에는 hudText 만 보이고 resultText 는 hidden. resolved 시 swap + tween 트리거.
    const resultText = this.add.text(centerX, centerY, '', {
      color: '#ffe17a',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#1a0a00',
      strokeThickness: 4,
    });
    resultText.setOrigin(0.5, 0.5);
    resultText.setAlpha(0);
    resultText.setVisible(false);
    resultText.setDepth(BUBBLE_DEPTH + 3);

    const bubble: PhaseBubble = {
      host,
      localTime: 0,
      spawnedAt: this.gameTime,
      resolvedAt: null,
      centerX,
      centerY,
      size: BUBBLE_SIZE,
      wave,
      viruses: [],
      shieldHitEffects: [],
      frameGfx,
      contentsGfx,
      virusLayer,
      hudText,
      resultText,
      closed: false,
      closing: false,
      closeStartedAt: 0,
    };
    this.bubbles.push(bubble);
    console.log('[spawnBubble] host=', host.x.toFixed(0), host.y.toFixed(0), 'slot=', slot);
  }

  // 게임: 풍선 닫기 요청 — 즉시 destroy 안 함. closing=true 만 set, updateBubble 이 페이드 아웃 진행.
  //   페이드 끝나면 destroyBubble 가 실제 정리. wave 결과 자동 종료 / host 사망 / 결과 표시 후 모두 동일 경로.
  private closeBubble(bubble: PhaseBubble): void {
    if (bubble.closing || bubble.closed) return;
    bubble.closing = true;
    bubble.closeStartedAt = this.gameTime;
    console.log('[closeBubble] fade-out start, remaining=', this.bubbles.length);
  }

  // 게임: 페이드 아웃 완료 후 실제 정리 — graphics destroy + 풀에서 제거.
  private destroyBubble(bubble: PhaseBubble): void {
    if (bubble.closed) return;
    bubble.closed = true;
    for (const v of bubble.viruses) v.gfx.destroy();
    bubble.viruses = [];
    for (const e of bubble.shieldHitEffects) e.gfx.destroy();
    bubble.shieldHitEffects = [];
    bubble.frameGfx.destroy();
    bubble.contentsGfx.destroy();
    bubble.virusLayer.destroy();
    bubble.hudText.destroy();
    bubble.resultText.destroy();
    const idx = this.bubbles.indexOf(bubble);
    if (idx >= 0) this.bubbles.splice(idx, 1);
    console.log('[destroyBubble] removed, remaining=', this.bubbles.length);
  }

  // 게임: 풍선의 현재 alpha — 페이드 인 (spawnedAt→ +DURATION) + 페이드 아웃 (closing→ +DURATION).
  //   페이드 인 = (gameTime - spawnedAt) / DURATION. 1 도달 후 정상.
  //   페이드 아웃 = 1 - (gameTime - closeStartedAt) / DURATION. 0 도달 시 destroyBubble 시점.
  private bubbleAlpha(b: PhaseBubble): number {
    if (b.closing) {
      const tt = (this.gameTime - b.closeStartedAt) / BUBBLE_FADE_DURATION;
      return Math.max(0, 1 - tt);
    }
    const tt = (this.gameTime - b.spawnedAt) / BUBBLE_FADE_DURATION;
    return Math.min(1, tt);
  }

  // 게임: 특정 host 가 이미 풍선 보유 중인지. spawn 시 중복 방지용.
  private isHostingBubble(host: import('../entities/WhiteCell').WhiteCell): boolean {
    for (const b of this.bubbles) if (b.host === host) return true;
    return false;
  }

  // 게임: (x,y) 가 풍선 영역 안인지 — 사각형 hit test. 클릭 분기용.
  private isPointInBubble(x: number, y: number, b: PhaseBubble): boolean {
    const half = b.size / 2;
    return x >= b.centerX - half && x <= b.centerX + half
        && y >= b.centerY - half && y <= b.centerY + half;
  }

  // 게임: 매 프레임 활성 풍선들 갱신 — 외부 sim 과 동시 진행. host 사라짐 시 즉시 close 요청.
  //   각 풍선의 localTime 는 외부 dt 와 동기 (speedMultiplier 영향 동일).
  //   host 사라짐 = isDead() (hp<=0) OR isAbsorbed (풀에서 제거 예정 / 이미 제거됨).
  //   변이 후 heal 된 호중구는 hp 풀이라 isDead()=false. hyperactive 폭발 / corruption finale 등으로
  //   isAbsorbed=true 만 set 되는 경우도 잡음.
  //   ⚠ closing 풍선도 updateBubble 호출해야 페이드 진행 + destroyBubble 도달. continue 금지.
  private updateBubbles(dt: number): void {
    // 게임: 역순 — 닫는 풍선이 배열에서 제거되므로.
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      // 게임: 아직 closing 안 된 풍선의 host 가 사라지면 close 요청만 set. update 가 페이드 진행.
      if (!b.closing && (b.host.isDead() || b.host.isAbsorbed)) {
        console.log('[updateBubbles] host gone → close bubble',
          'isDead=', b.host.isDead(), 'isAbsorbed=', b.host.isAbsorbed);
        this.closeBubble(b);
      }
      this.updateBubble(b, dt);
    }
  }

  // 게임: 단일 풍선 갱신 — wave spawn → 컨텐츠 갱신 → wave 종결 판정 → 결과 후 자동 close.
  //   closing 중에는 wave/바이러스 진행 X (시각 페이드만). alpha 는 매 프레임 계산해 graphics 전체 적용.
  private updateBubble(b: PhaseBubble, dt: number): void {
    const alpha = this.bubbleAlpha(b);
    this.applyBubbleAlpha(b, alpha);

    // 게임: closing 진행 — alpha 0 도달 시 실제 destroy. wave 갱신 안 함.
    if (b.closing) {
      this.drawBubbleFrame(b);
      this.drawBubbleDnaHelix(b, false);
      if (alpha <= 0) this.destroyBubble(b);
      return;
    }

    b.localTime += dt;
    const t = b.localTime;
    const wave = b.wave;

    // 1) wave 자동 spawn
    if (!wave.resolved) {
      while (wave.spawnQueue.length > 0 && t >= wave.nextSpawnTime) {
        const kind = wave.spawnQueue.shift()!;
        const angle = Math.random() * Math.PI * 2;
        this.spawnVirusInBubble(b, angle, kind);
        wave.nextSpawnTime = t + WAVE_SPAWN_INTERVAL;
      }
    }

    const shieldActive = this.isBubbleShieldActive(b);
    this.drawBubbleFrame(b);
    this.drawBubbleDnaHelix(b, shieldActive);
    this.updateBubbleViruses(b);
    this.updateBubbleShieldHitEffects(b);

    // 2) wave 종결 판정
    if (!wave.resolved && wave.spawnQueue.length === 0 && b.viruses.length === 0) {
      this.finalizeBubbleWave(b);
    }

    // 3) 결과 표시 후 WAVE_RESULT_DELAY 경과 → 자동 close
    if (wave.resolved && b.resolvedAt !== null && t - b.resolvedAt >= WAVE_RESULT_DELAY) {
      this.closeBubble(b);
      return;
    }

    // 4) HUD — resolved 면 hudText 숨김 + resultText 강조. 진행 중이면 모드별 안내.
    if (wave.resolved) {
      b.hudText.setVisible(false);
      b.resultText.setVisible(true);
    } else {
      b.hudText.setVisible(true);
      b.resultText.setVisible(false);
      const fired = WAVE_TOTAL - wave.spawnQueue.length - b.viruses.length;
      const line1 = `wave ${fired}/${WAVE_TOTAL}  hits ${wave.hits}/${WAVE_TOTAL}  변이율 ${wave.hits * 10}%`;
      const line2 = this.interactive
        ? `쉴드 ${wave.shieldCharges}/${WAVE_SHIELD_CHARGES} (${shieldActive ? 'ON' : 'OFF'})  · 클릭으로 발동`
        : `관전 모드 — 자체 면역 ${Math.round((1 - HIT_PROB_OBSERVE) * 100)}% 자동 차단`;
      b.hudText.setText(`${line1}\n${line2}`);
    }
  }

  // 게임: 풍선 전체 graphics 에 alpha 적용. 페이드 인/아웃 매 프레임 호출.
  private applyBubbleAlpha(b: PhaseBubble, alpha: number): void {
    b.frameGfx.setAlpha(alpha);
    b.contentsGfx.setAlpha(alpha);
    b.virusLayer.setAlpha(alpha);
    b.hudText.setAlpha(alpha);
    b.resultText.setAlpha(alpha);
  }

  // 게임: 풍선 frame 그리기 — 둥근 사각형 + 외곽선 + host 까지 꼬리 line.
  //   매 프레임 갱신 (host 위치가 움직이므로 꼬리도 따라감). Stage B 에서 꼬리 곡선 폴리싱 예정.
  private drawBubbleFrame(b: PhaseBubble): void {
    const half = b.size / 2;
    const left = b.centerX - half;
    const top = b.centerY - half;
    b.frameGfx.clear();
    // 게임: 배경 — 반투명 어두운 색.
    b.frameGfx.fillStyle(BUBBLE_BG_COLOR, BUBBLE_BG_ALPHA);
    b.frameGfx.fillRoundedRect(left, top, b.size, b.size, BUBBLE_CORNER_RADIUS);
    // 게임: 외곽선.
    b.frameGfx.lineStyle(BUBBLE_BORDER_WIDTH, BUBBLE_BORDER_COLOR, 1);
    b.frameGfx.strokeRoundedRect(left, top, b.size, b.size, BUBBLE_CORNER_RADIUS);
    // 게임: 꼬리 — 풍선 가장자리 (host 방향) → host. 단순 직선.
    //   host 가 풍선 위/왼쪽/오른쪽/아래 어디 있든 풍선 중심에서 host 로 ray 쏴 풍선 경계 점 산출.
    const hx = b.host.x;
    const hy = b.host.y;
    const edge = this.bubbleEdgePoint(b, hx, hy);
    b.frameGfx.lineStyle(BUBBLE_TAIL_WIDTH, BUBBLE_TAIL_COLOR, BUBBLE_TAIL_ALPHA);
    b.frameGfx.lineBetween(edge.x, edge.y, hx, hy);
  }

  // 게임: 풍선 경계에서 (tx,ty) 방향의 점 산출. 단순화 — 풍선 사각형의 변과 ray 교차.
  //   tx,ty 가 풍선 안이면 풍선 중심 반환 (꼬리 안 그림).
  private bubbleEdgePoint(b: PhaseBubble, tx: number, ty: number): { x: number; y: number } {
    const half = b.size / 2;
    const dx = tx - b.centerX;
    const dy = ty - b.centerY;
    if (Math.abs(dx) < half && Math.abs(dy) < half) return { x: b.centerX, y: b.centerY };
    // 게임: ray 가 만나는 변 — 더 빨리 도달하는 축.
    const tx_ = dx !== 0 ? half / Math.abs(dx) : Infinity;
    const ty_ = dy !== 0 ? half / Math.abs(dy) : Infinity;
    const tHit = Math.min(tx_, ty_);
    return { x: b.centerX + dx * tHit, y: b.centerY + dy * tHit };
  }

  // 게임: 풍선 안 DNA 나선 — contentsGfx 는 풍선 중심 (centerX,centerY) origin.
  //   로컬 (lx, ly) 좌표 기준. hits 만큼 corrupted, shieldActive 면 두께 ↑.
  private drawBubbleDnaHelix(b: PhaseBubble, shieldActive: boolean): void {
    const gfx = b.contentsGfx;
    const t = b.localTime;
    const hits = b.wave.hits;
    const LENGTH = 80;
    const RADIUS = 24;
    const TURNS = 2;
    const SUBSTEPS = 6;
    const SPIN = 1.5;
    const TILT = Math.PI / 4;
    const cosT = Math.cos(TILT);
    const sinT = Math.sin(TILT);

    const STRAND_HEALTHY = 0x88ff99;
    const STRAND_CORRUPTED = 0xff5566;
    const PAIR_HEALTHY = 0x336644;
    const PAIR_CORRUPTED = 0x802233;
    const strandWidth = shieldActive ? DNA_STRAND_WIDTH_SHIELD : DNA_STRAND_WIDTH;
    const pairWidth = shieldActive ? DNA_PAIR_WIDTH_SHIELD : DNA_PAIR_WIDTH;

    gfx.clear();

    for (let strand = 0; strand < 2; strand++) {
      const phaseOffset = strand * Math.PI;
      for (let seg = 0; seg < DNA_SEGMENTS; seg++) {
        const corrupted = seg < hits;
        const color = corrupted ? STRAND_CORRUPTED : STRAND_HEALTHY;
        const alpha = corrupted ? 1.0 : 0.95;
        gfx.lineStyle(strandWidth, color, alpha);
        for (let s = 0; s < SUBSTEPS; s++) {
          const i0 = seg * SUBSTEPS + s;
          const i1 = i0 + 1;
          const total = DNA_SEGMENTS * SUBSTEPS;
          const u0 = i0 / total;
          const u1 = i1 / total;
          const a0 = u0 * TURNS * Math.PI * 2 + t * SPIN + phaseOffset;
          const a1 = u1 * TURNS * Math.PI * 2 + t * SPIN + phaseOffset;
          const lx0 = Math.cos(a0) * RADIUS;
          const ly0 = (u0 - 0.5) * LENGTH;
          const lx1 = Math.cos(a1) * RADIUS;
          const ly1 = (u1 - 0.5) * LENGTH;
          const x0 = lx0 * cosT - ly0 * sinT;
          const y0 = lx0 * sinT + ly0 * cosT;
          const x1 = lx1 * cosT - ly1 * sinT;
          const y1 = lx1 * sinT + ly1 * cosT;
          gfx.lineBetween(x0, y0, x1, y1);
        }
      }
    }

    for (let seg = 0; seg < DNA_SEGMENTS; seg++) {
      const corrupted = seg < hits;
      const color = corrupted ? PAIR_CORRUPTED : PAIR_HEALTHY;
      const alpha = corrupted ? 0.95 : 0.7;
      gfx.lineStyle(pairWidth, color, alpha);
      const u = (seg + 0.5) / DNA_SEGMENTS;
      const a = u * TURNS * Math.PI * 2 + t * SPIN;
      const lx0 = Math.cos(a) * RADIUS;
      const lx1 = Math.cos(a + Math.PI) * RADIUS;
      const ly = (u - 0.5) * LENGTH;
      const x0 = lx0 * cosT - ly * sinT;
      const y0 = lx0 * sinT + ly * cosT;
      const x1 = lx1 * cosT - ly * sinT;
      const y1 = lx1 * sinT + ly * cosT;
      gfx.lineBetween(x0, y0, x1, y1);
    }
  }

  // 게임: 단일 바이러스 spawn — 풍선 좌표계 안. spawn 점 = 풍선 외곽 (반지름 BUBBLE_SIZE/2 - 16) 의 angle 점.
  //   진행 방향 = 풍선 중심 (DNA 가운데). bornTime = b.localTime.
  private spawnVirusInBubble(b: PhaseBubble, angle: number, kind: Virus['kind']): void {
    const spawnR = b.size / 2 - 16;
    const sx = Math.cos(angle) * spawnR;
    const sy = Math.sin(angle) * spawnR;
    const dx = -sx;
    const dy = -sy;
    const len = Math.hypot(dx, dy) || 1;
    const baseDirX = dx / len;
    const baseDirY = dy / len;

    const gfx = this.add.graphics();
    const color = kind === 'straight' ? 0xff5577 : kind === 'zigzag' ? 0xffaa44 : 0x66ccff;
    gfx.fillStyle(color, 1);
    gfx.fillCircle(0, 0, 4);
    gfx.setPosition(sx, sy);
    b.virusLayer.add(gfx);

    const speed = VIRUS_SPEED_MIN + Math.random() * (VIRUS_SPEED_MAX - VIRUS_SPEED_MIN);

    b.viruses.push({
      kind,
      bornTime: b.localTime,
      spawnX: sx,
      spawnY: sy,
      baseDirX,
      baseDirY,
      speed,
      amplitude: 25 + Math.random() * 15,
      frequency: 4 + Math.random() * 2,
      initialDist: len,
      initialAngle: Math.atan2(sy, sx),
      angularVelocity: (Math.random() < 0.5 ? 1 : -1) * (1 + Math.random()),
      inwardSpeed: speed,
      x: sx,
      y: sy,
      gfx,
    });
  }

  // 게임: 풍선 안 바이러스 위치 갱신. 풍선 좌표계 기준. DNA 도달 (중심=0,0) 검사.
  //   풍선 영역 밖 또는 수명 만료 시 hit 미증가로 소멸.
  private updateBubbleViruses(b: PhaseBubble): void {
    const t = b.localTime;
    const half = b.size / 2;

    for (let i = b.viruses.length - 1; i >= 0; i--) {
      const v = b.viruses[i];
      const tElapsed = t - v.bornTime;

      if (v.kind === 'straight') {
        const distAlong = v.speed * tElapsed;
        v.x = v.spawnX + v.baseDirX * distAlong;
        v.y = v.spawnY + v.baseDirY * distAlong;
      } else if (v.kind === 'zigzag') {
        const distAlong = v.speed * tElapsed;
        const baseX = v.spawnX + v.baseDirX * distAlong;
        const baseY = v.spawnY + v.baseDirY * distAlong;
        const perpX = -v.baseDirY;
        const perpY = v.baseDirX;
        const off = v.amplitude * Math.sin(tElapsed * v.frequency);
        v.x = baseX + perpX * off;
        v.y = baseY + perpY * off;
      } else {
        const dist = Math.max(0, v.initialDist - v.inwardSpeed * tElapsed);
        const angle = v.initialAngle + v.angularVelocity * tElapsed;
        v.x = Math.cos(angle) * dist;
        v.y = Math.sin(angle) * dist;
      }

      v.gfx.setPosition(v.x, v.y);

      // 게임: DNA 도달 (풍선 중심) 검사.
      //   처리 순서: (1) 쉴드 활성 → 무조건 차단. (2) hit 확률 검사 (관전 0.4, 개입 1.0).
      //   확률 실패 = 자체 면역 차단 — 시각상 쉴드와 같은 펄스 이펙트.
      if (v.x * v.x + v.y * v.y < VIRUS_HIT_RADIUS * VIRUS_HIT_RADIUS) {
        const shielded = this.isBubbleShieldActive(b);
        const hitProb = this.interactive ? HIT_PROB_INTERACTIVE : HIT_PROB_OBSERVE;
        const success = !shielded && Math.random() < hitProb;
        const vx = v.x;
        const vy = v.y;
        v.gfx.destroy();
        b.viruses.splice(i, 1);
        if (!b.wave.resolved) {
          if (success) {
            b.wave.hits++;
          } else {
            this.spawnBubbleShieldHitEffect(b, vx, vy);
          }
        }
        continue;
      }

      // 게임: 풍선 밖 또는 수명 만료 — DNA 못 맞히고 지나감.
      const outOfBounds =
        v.x < -half - VIRUS_OUTOFBOUND_MARGIN || v.x > half + VIRUS_OUTOFBOUND_MARGIN ||
        v.y < -half - VIRUS_OUTOFBOUND_MARGIN || v.y > half + VIRUS_OUTOFBOUND_MARGIN;
      const expired = tElapsed > VIRUS_MAX_LIFETIME;
      if (outOfBounds || expired) {
        v.gfx.destroy();
        b.viruses.splice(i, 1);
      }
    }
  }

  // 게임: 풍선 안 쉴드 차단 이펙트 spawn — 풍선 좌표계 (centerX/Y origin).
  private spawnBubbleShieldHitEffect(b: PhaseBubble, x: number, y: number): void {
    const gfx = this.add.graphics();
    gfx.setPosition(x, y);
    b.virusLayer.add(gfx);
    b.shieldHitEffects.push({ x, y, bornTime: b.localTime, gfx });
  }

  // 게임: 풍선 안 쉴드 이펙트 갱신.
  private updateBubbleShieldHitEffects(b: PhaseBubble): void {
    const t = b.localTime;
    for (let i = b.shieldHitEffects.length - 1; i >= 0; i--) {
      const e = b.shieldHitEffects[i];
      const tt = (t - e.bornTime) / SHIELD_HIT_DURATION;
      if (tt >= 1) {
        e.gfx.destroy();
        b.shieldHitEffects.splice(i, 1);
        continue;
      }
      const r = SHIELD_HIT_RADIUS_START + (SHIELD_HIT_RADIUS_END - SHIELD_HIT_RADIUS_START) * tt;
      const alpha = 1 - tt;
      e.gfx.clear();
      e.gfx.lineStyle(2, SHIELD_HIT_COLOR, alpha);
      e.gfx.strokeCircle(0, 0, r);
    }
  }

  // 게임: 풍선 쉴드 활성 여부.
  private isBubbleShieldActive(b: PhaseBubble): boolean {
    if (b.wave.resolved) return false;
    return b.localTime < b.wave.shieldActiveUntil;
  }

  // 게임: 풍선 쉴드 발동 — 클릭으로 호출. 풍선별 charges/cooldown 독립.
  private tryActivateBubbleShield(b: PhaseBubble): void {
    const w = b.wave;
    if (w.resolved) return;
    if (w.shieldCharges <= 0) return;
    if (this.isBubbleShieldActive(b)) return;
    w.shieldCharges--;
    w.shieldActiveUntil = b.localTime + WAVE_SHIELD_DURATION;
  }

  // 게임: 풍선 wave 종결 처리 — pickMutation → host 에 적용. host 사망 시 변이 적용 X.
  //   결과 텍스트는 b.resultText 에 표시, WAVE_RESULT_DELAY 후 updateBubble 이 자동 closeBubble.
  private finalizeBubbleWave(b: PhaseBubble): void {
    const wave = b.wave;
    if (wave.resolved) return;
    wave.resolved = true;
    wave.resolvedAt = b.localTime;
    b.resolvedAt = b.localTime;

    const kind = pickMutation(wave.hits);
    if (kind === null) {
      b.resultText.setText(`정상\nhits 0/${WAVE_TOTAL}`);
      b.resultText.setScale(0.3);
      this.tweens.add({
        targets: b.resultText,
        scale: 1.0,
        ease: 'Back.Out',
        duration: 450,
      });
      console.log('[finalizeBubbleWave] hits=0 → no mutation');
      return;
    }
    if (!b.host.isDead()) {
      const newDna = applyMutation(b.host.dna, kind);
      b.host.setDna(newDna);
      b.host.setMutation(kind);
      if (kind === 'cancer') b.host.beginCancerDivide(this.gameTime);
      if (kind === 'corruption') b.host.beginCorruption(this.gameTime);
      if (kind === 'hyperactive') b.host.beginHyperactive(this.gameTime);
      if (kind === 'paralysis') b.host.beginParalysis(this.gameTime);
    }
    const info = MUTATION_INFO[kind];
    b.resultText.setText(`변이 ${info.num}: ${info.label}\nhits ${wave.hits}/${WAVE_TOTAL}`);
    // 게임: 팝 이펙트 — scale 0.3 → 1.0 with Back.Out (overshoot). 시각 강조 + 사용자 주의 환기.
    //   Phaser tween 사용 — real time 기준이라 speedMultiplier 영향 X (0.45s 면 빨리감기에도 무관).
    //   Container 가 아닌 Text 의 setScale 은 origin(0.5,0.5) 기준 = 중앙 팝.
    b.resultText.setScale(0.3);
    this.tweens.add({
      targets: b.resultText,
      scale: 1.0,
      ease: 'Back.Out',
      duration: 450,
    });
    console.log('[finalizeBubbleWave] hits=', wave.hits, 'kind=', kind);
  }

  // 게임: 스테이지 wave 스케줄 — gameTime 도달한 wave 의 steps 일괄 실행 (Session 22).
  //   nextWaveIndex 부터 순차 검사 (배열은 atSec 오름차순 가정). steps 안은 주로 spawn.
  private processStageWaves(t: number): void {
    const waves = this.currentStage.waves;
    while (this.nextWaveIndex < waves.length) {
      const w = waves[this.nextWaveIndex];
      if (t < w.atSec) break;
      console.log('[stage wave]', this.nextWaveIndex, 'atSec=', w.atSec, 'steps=', w.steps.length);
      for (const step of w.steps) this.runStageStep(step);
      this.nextWaveIndex++;
    }
  }

  // 게임: 스테이지 결과 판정 — 매 프레임 호출. 한 번 resolved 되면 무시.
  //   1) endConditions 위→아래 검사, 첫 일치가 결과 (clear / wipe).
  //      단 'bacteriaEliminated' 는 spawned > 0 + 모든 wave 처리 완료여야 만 clear (초기 0 false-positive 방지).
  //   2) gameTime >= timeLimit → 시간 초과. 비율로 ★2/★1/실패.
  private checkStageResolution(t: number): void {
    if (this.stageState !== 'running') return;
    const stage = this.currentStage;
    const spawned = this.bacteriaBehavior.getStageSpawned();
    const killed = this.bacteriaBehavior.getStageKilled();
    const allWavesProcessed = this.nextWaveIndex >= stage.waves.length;

    for (const cond of stage.endConditions) {
      let matched = false;
      switch (cond.check) {
        case 'bacteriaEliminated':
          matched = allWavesProcessed && spawned > 0 && this.bacteriaBehavior.getAlive().length === 0;
          break;
        case 'whiteCellsEliminated':
          matched = this.whiteCellBehavior.getAlive().length === 0;
          break;
        case 'neutrophilsEliminated': {
          // 게임: 호중구 = NEUTROPHIL / NK_CELL / NEUTROPHIL_SUPER. T/B 는 보조라 전투 능력 X.
          matched = this.whiteCellBehavior.getAlive().filter((c) =>
            c.dnaKind === 'NEUTROPHIL' || c.dnaKind === 'NK_CELL' || c.dnaKind === 'NEUTROPHIL_SUPER',
          ).length === 0;
          break;
        }
      }
      if (matched) {
        if (cond.result === 'clear') {
          this.resolveStage({ kind: 'clear', stars: 3, killed, total: spawned, elapsedSec: t });
        } else {
          this.resolveStage({ kind: 'wipe', stars: 0, killed, total: spawned, elapsedSec: t });
        }
        return;
      }
    }

    if (t >= stage.timeLimit) {
      const ratio = spawned > 0 ? Math.min(1, killed / spawned) : 0;
      let stars: 0 | 1 | 2 = 0;
      if (ratio >= stage.stars.twoRatio) stars = 2;
      else if (ratio >= stage.stars.oneRatio) stars = 1;
      this.resolveStage({ kind: 'timeout', stars, killed, total: spawned });
    }
  }

  // 게임: 결과 set + 모달 표시. stageState='resolved' 로 sim 정지 (update 안 분기 처리).
  //   결과 모달 (scene.restart 시 자동 destroy) — 명시 ref 안 보유.
  //   진행 조건 = 1★ 이상 (clear ★3 / timeout ★2 / timeout ★1). 0★ (wipe / timeout 실패) 는 재시작만.
  //   마지막 스테이지 클리어는 GAME COMPLETE 표시.
  private resolveStage(result: StageResult): void {
    this.stageState = 'resolved';
    this.lastStageResult = result;
    console.log('[stage resolved]', this.currentStage.id, result);
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const starChars = result.stars >= 1 ? '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars) : '실패';
    const headline =
      result.kind === 'clear' ? '클리어!' :
      result.kind === 'wipe'  ? '호중구 전멸' :
      '시간 종료';
    const isLast = this.currentStageIndex >= STAGES.length - 1;
    const canAdvance = result.stars >= 1;
    // 게임: 키 안내는 데스크탑용 보조 — 모바일은 아래 버튼. GAME COMPLETE 만 텍스트로.
    const guide = canAdvance && isLast ? '🎉 GAME COMPLETE 🎉' : '';
    const body = `STAGE ${this.currentStageIndex + 1} — ${this.currentStage.title}\n${headline}\n${starChars}\n잡은 세균 ${result.killed}/${result.total}${guide ? '\n\n' + guide : ''}`;
    const text = this.add.text(W / 2, H * 0.38, body, {
      color: '#ffe17a',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '28px',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#1a0a00',
      strokeThickness: 5,
      backgroundColor: '#000000aa',
      padding: { x: 32, y: 20 },
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(BUBBLE_DEPTH + 10);

    // 게임: 모바일 대응 — [SPACE]/[R] 키 동작을 버튼으로. 키도 그대로 동작 (데스크탑).
    const btnY = H * 0.62;
    if (canAdvance && !isLast) {
      this.addModalButton('다음 스테이지 ▶', W / 2 - 96, btnY, 0x2a5a3a, () => {
        if (this.perkSelecting) return;
        this.showPerkSelect(this.currentStageIndex + 1);
      });
      this.addModalButton('재시작 ↻', W / 2 + 96, btnY, 0x3a3a5a, () => this.restartStage());
    } else if (canAdvance && isLast) {
      this.addModalButton('처음부터 ↻', W / 2, btnY, 0x3a3a5a, () =>
        this.scene.restart({ stageIndex: 0, skipIntro: false }));
    } else {
      this.addModalButton('재시작 ↻', W / 2, btnY, 0x5a3a3a, () => this.restartStage());
    }
  }

  // 게임: 결과 모달 버튼 — 둥근 사각 bg + 라벨 + 투명 Zone (클릭). scene.restart 시 자동 destroy.
  private addModalButton(label: string, cx: number, cy: number, color: number, onClick: () => void): void {
    const bw = 176;
    const bh = 52;
    const depth = BUBBLE_DEPTH + 11;
    const bg = this.add.graphics().setDepth(depth);
    bg.fillStyle(color, 0.95);
    bg.lineStyle(2, 0xffffff, 0.5);
    bg.fillRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 10);
    bg.strokeRoundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 10);
    const txt = this.add.text(cx, cy, label, {
      color: '#ffffff', fontFamily: 'ui-monospace, monospace', fontSize: '17px', fontStyle: 'bold',
    }).setOrigin(0.5, 0.5).setDepth(depth + 1);
    void txt;
    const zone = this.add.zone(cx, cy, bw, bh).setInteractive();
    zone.setDepth(depth + 2);
    zone.on('pointerdown', onClick);
  }

  // 게임: 현재 스테이지 재시작 — index 유지, 첫 스테이지만 intro 재생 (디버그 편의).
  private restartStage(): void {
    this.scene.restart({ stageIndex: this.currentStageIndex, skipIntro: this.currentStageIndex > 0 });
  }

  // 게임: 특전 선택 화면 — 결과 모달 [SPACE] 후 표시. 7종 중 랜덤 3개 카드.
  //   카드 클릭 → applyPerk(id) → 다음 스테이지 restart (특전 누적은 module singleton 이라 유지).
  //   카드/배경 GameObject 는 scene.restart 시 자동 destroy.
  private showPerkSelect(nextStageIndex: number): void {
    this.perkSelecting = true;
    const W = this.scale.width;
    const H = this.effectiveHeight();
    const picks = pickRandomPerks(3);

    // 게임: 전체 어둡게 (모달 위 추가 오버레이) + 안내.
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.7);
    overlay.fillRect(0, 0, W, this.scale.height);
    overlay.setDepth(BUBBLE_DEPTH + 20);

    const title = this.add.text(W / 2, H * 0.22, '특전 선택 — 하나를 고르세요', {
      color: '#ffe17a',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '24px',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#1a0a00',
      strokeThickness: 4,
    });
    title.setOrigin(0.5, 0.5);
    title.setDepth(BUBBLE_DEPTH + 21);

    // 게임: 카드 3장 가로 배치. 화면 폭에 맞춰 카드 너비/간격 결정 (모바일 좁은 폭 대응).
    const n = picks.length;
    const gap = 16;
    const cardW = Math.min(220, (W - gap * (n + 1)) / n);
    const cardH = 160;
    const totalW = cardW * n + gap * (n - 1);
    const startX = (W - totalW) / 2;
    const cardY = H * 0.5;

    for (let i = 0; i < n; i++) {
      const def = picks[i];
      const cx = startX + i * (cardW + gap) + cardW / 2;

      const bg = this.add.graphics();
      bg.fillStyle(0x12203a, 0.95);
      bg.lineStyle(2, 0x88ccff, 1);
      bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
      bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
      bg.setDepth(BUBBLE_DEPTH + 21);

      const label = this.add.text(cx, cardY, `${def.name}\n\n${def.desc}`, {
        color: '#ffffff',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '15px',
        align: 'center',
        wordWrap: { width: cardW - 20 },
        lineSpacing: 6,
      });
      label.setOrigin(0.5, 0.5);
      label.setDepth(BUBBLE_DEPTH + 22);
      // 게임: 카드 hit 영역 = 투명 Zone (cardW × cardH). 클릭 = 선택. label 위에 깔아 클릭 캐치.
      const zone = this.add.zone(cx, cardY, cardW, cardH);
      zone.setInteractive();
      zone.setDepth(BUBBLE_DEPTH + 23);
      zone.on('pointerdown', () => {
        if (!this.perkSelecting) return;  // 중복 클릭 방지
        this.perkSelecting = false;
        applyPerk(def.id);
        // 게임: 스테이지 클리어 보상 — 스킬 충전 각 +1 (사용분은 차감된 채 이월).
        addStageSkillCharges();
        this.scene.restart({ stageIndex: nextStageIndex, skipIntro: true });
      });
    }
  }

  // 게임: 대식세포 수동 입력 처리 — cursor 키 isDown 매 프레임 검사. 누름 시 manualUntil/Dir 갱신.
  //   동시 누름 = dir 0 (정지). 만료는 MacrophageSystem 가 t < manualUntil 검사로 처리.
  private applyMacrophageManualInput(t: number): void {
    if (this.cursors === null) return;
    const leftDown = this.cursors.left.isDown;
    const rightDown = this.cursors.right.isDown;
    if (!leftDown && !rightDown) return;
    const dir = ((leftDown ? -1 : 0) + (rightDown ? 1 : 0)) as -1 | 0 | 1;
    const until = t + MACROPHAGE_MANUAL_TIMEOUT;
    for (const m of this.macrophageSystem.getAll()) {
      m.manualUntil = until;
      m.manualDirX = dir;
    }
  }

  // 게임: 디버그용 호중구 스폰 — 무작위 위치, 100% hp.
  private spawnNeutrophils(count: number): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    for (let i = 0; i < count; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      this.whiteCellBehavior.spawn(NEUTROPHIL, x, y, phase);
    }
  }

  // 게임: 하단 스킬 버튼 2개 생성 — 좌: 호중구 추가, 우: 세균 추가. effectiveHeight 아래 바 영역.
  //   클릭 Zone + 배경 Graphics + 라벨 Text. charge 표시는 updateSkillButtons.
  private createSkillButtons(): void {
    const W = this.scale.width;
    const barTop = this.effectiveHeight();
    const barBottom = this.scale.height - (this.isMobile ? BOTTOM_RESERVE_MOBILE : 0);
    const cy = (barTop + barBottom) / 2;
    const half = W / 2;
    const pad = 6;
    const depth = BUBBLE_DEPTH + 5;

    // 게임: 호중구 버튼 (좌측 절반).
    this.skillNeutBg = this.add.graphics().setDepth(depth);
    this.skillNeutText = this.add.text(half / 2, cy, '', {
      color: '#ffffff', fontFamily: 'ui-monospace, monospace', fontSize: '15px',
      fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0.5).setDepth(depth + 1);
    this.skillNeutZone = this.add.zone(half / 2, cy, half - pad * 2, barBottom - barTop - pad * 2).setInteractive();
    this.skillNeutZone.setDepth(depth + 2);
    this.skillNeutZone.on('pointerdown', () => this.useNeutrophilSkill());

    // 게임: 세균 버튼 (우측 절반).
    this.skillBactBg = this.add.graphics().setDepth(depth);
    this.skillBactText = this.add.text(half + half / 2, cy, '', {
      color: '#ffffff', fontFamily: 'ui-monospace, monospace', fontSize: '15px',
      fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0.5).setDepth(depth + 1);
    this.skillBactZone = this.add.zone(half + half / 2, cy, half - pad * 2, barBottom - barTop - pad * 2).setInteractive();
    this.skillBactZone.setDepth(depth + 2);
    this.skillBactZone.on('pointerdown', () => this.useBacteriaSkill());

    this.updateSkillButtons();
  }

  // 게임: 스킬 바 표시/숨김 — running phase 에만 보임 (컷신/placing 중엔 숨김 + 클릭 비활성).
  //   매 프레임 update 가 phase 따라 호출.
  private setSkillBarVisible(visible: boolean): void {
    this.skillNeutBg.setVisible(visible);
    this.skillBactBg.setVisible(visible);
    this.skillNeutText.setVisible(visible);
    this.skillBactText.setVisible(visible);
    // 게임: Zone 은 visible 무관하게 input 받으므로 interactive 도 토글.
    this.skillNeutZone.setVisible(visible);
    this.skillBactZone.setVisible(visible);
    if (visible) { this.skillNeutZone.setInteractive(); this.skillBactZone.setInteractive(); }
    else { this.skillNeutZone.disableInteractive(); this.skillBactZone.disableInteractive(); }
  }

  // 게임: 스킬 버튼 배경/텍스트 갱신 — charge 수 표시 + 0 이면 회색 (비활성 시각).
  private updateSkillButtons(): void {
    const W = this.scale.width;
    const barTop = this.effectiveHeight();
    const barBottom = this.scale.height - (this.isMobile ? BOTTOM_RESERVE_MOBILE : 0);
    const half = W / 2;
    const pad = 6;
    const h = barBottom - barTop - pad * 2;

    const charges = getSkillCharges();
    // 게임: 호중구 (연분홍 활성 / 회색 비활성).
    const neutColor = charges.neutrophil > 0 ? 0x5a3a4a : 0x2a2a2a;
    this.skillNeutBg.clear();
    this.skillNeutBg.fillStyle(neutColor, 0.95);
    this.skillNeutBg.fillRoundedRect(pad, barTop + pad, half - pad * 2, h, 8);
    this.skillNeutText.setText(`+호중구 (${charges.neutrophil})`);
    this.skillNeutText.setColor(charges.neutrophil > 0 ? '#ffd0e0' : '#777777');

    // 게임: 세균 (어두운 회색 활성 / 더 어두움 비활성).
    const bactColor = charges.bacteria > 0 ? 0x3a3a3a : 0x2a2a2a;
    this.skillBactBg.clear();
    this.skillBactBg.fillStyle(bactColor, 0.95);
    this.skillBactBg.fillRoundedRect(half + pad, barTop + pad, half - pad * 2, h, 8);
    this.skillBactText.setText(`+세균 (${charges.bacteria})`);
    this.skillBactText.setColor(charges.bacteria > 0 ? '#dddddd' : '#777777');
  }

  // 게임: 호중구 스킬 — running 일 때만, charge > 0 이면 10마리 spawn + charge -1 (singleton).
  private useNeutrophilSkill(): void {
    if (this.phase !== 'running') return;
    if (!useNeutrophilCharge()) return;
    this.spawnNeutrophils(10);
    this.updateSkillButtons();
  }

  // 게임: 세균 스킬 — running 일 때만, charge > 0 이면 일반 세균 10마리 spawn (infected X) + charge -1.
  private useBacteriaSkill(): void {
    if (this.phase !== 'running') return;
    if (!useBacteriaCharge()) return;
    this.spawnBacteria(10);
    this.updateSkillButtons();
  }

  // 게임: 세균 spawn. forceInfected = 처음 N마리 강제 infected.
  //   [B] 디버그 키는 2 (페이즈 2 트리거 검증). 스킬 버튼은 0 (일반 세균만 — 점수용).
  private spawnBacteria(count: number, forceInfected = 0): void {
    const W = this.scale.width;
    const H = this.effectiveHeight();
    for (let i = 0; i < count; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      const b = this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
      // 게임: registry enabled=false 인 경우 spawn null. infected 부여 skip.
      if (b !== null && i < forceInfected) b.setInfected();
    }
  }

  // Phaser: 매 프레임 호출. delta 는 ms.
  override update(_time: number, delta: number): void {
    // 진단: 항상 보이는 HUD — phase + 풍선 풀 + 인터렉션 모드.
    if (this.debugHud) {
      const mode = this.interactive ? '개입' : '관전';
      const prob = this.interactive ? HIT_PROB_INTERACTIVE : HIT_PROB_OBSERVE;
      this.debugHud.setText(
        `phase=${this.phase}  bubbles=${this.bubbles.length}/${BUBBLE_MAX}  mode=${mode} (hit ${Math.round(prob * 100)}%)`,
      );
    }

    // 게임: 스킬 바 — running + 진행 중 (resolved 아님) 일 때만. 컷신/placing/결과모달 중 숨김.
    if (this.skillNeutBg) {
      this.setSkillBarVisible(this.phase === 'running' && this.stageState === 'running');
    }

    // 게임: 스테이지 HUD — 남은 시간 + 세균 진행. running 일 때만 표시 (cutscene/placing 중 숨김).
    //   stage 시간 = gameTime - stageStartTime. running 진입 시점에 stageStartTime 기록 (beginNextPlacement 끝).
    if (this.stageHudText) {
      if (this.phase === 'running') {
        const stageT = this.gameTime - this.stageStartTime;
        const remain = Math.max(0, this.currentStage.timeLimit - stageT);
        const mm = Math.floor(remain / 60).toString().padStart(2, '0');
        const ss = Math.floor(remain % 60).toString().padStart(2, '0');
        const killed = this.bacteriaBehavior.getStageKilled();
        const spawned = this.bacteriaBehavior.getStageSpawned();
        this.stageHudText.setText(`STAGE ${this.currentStageIndex + 1} ${this.currentStage.title}  ⏱ ${mm}:${ss}   세균 ${killed}/${spawned}`);
        this.stageHudText.setVisible(true);
      } else {
        this.stageHudText.setVisible(false);
      }
    }

    // 게임: 일시정지 — update 자체를 skip. gameTime 정지 → 모든 시각/물리 멈춤.
    if (this.paused) {
      this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  speed: ${this.speedMultiplier}x  [PAUSED]`);
      return;
    }

    // 게임: 스테이지 종료 (resolved) — sim 정지. 결과 모달만 표시. [R] 로 재시작 가능.
    if (this.stageState === 'resolved') {
      this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  [RESOLVED]`);
      return;
    }

    // 게임: 컷신 진행 — 텍스트박스/단어 타이핑/click 처리. 단계 6 마이그레이션 후 단순화:
    //   - updateCutscene 가 step 처리 (narration/control/spawn/pause/end)
    //   - sim 단계로 fall-through (entity 행동은 control('xxx', { frozen }) 으로 대본이 직접 제어)
    //   - 단, stage 시간/wave/판정/풍선 등은 컷신 중 skip — endCutscene 에서 stageStartTime 설정 후 진행.
    if (this.phase === 'cutscene') {
      this.updateCutscene(delta / 1000);
      this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  [CUTSCENE]`);
    }

    // 게임: 가상 시간 — Phaser this.time.now 무시. dt 에 speedMultiplier 곱하여 빨리감기.
    //        모든 시스템이 t/dt 를 인자로 받으므로 자동 가속.
    //        placement 중에는 dt=0 으로 시뮬레이션은 정지하되 렌더 흐름은 그대로 흘러
    //        일반 개체들이 화면에 정적으로 표시됨.
    const isPlacing = this.phase === 'placing';
    const dtReal = delta / 1000;
    const dt = isPlacing ? 0 : dtReal * this.speedMultiplier;
    if (!isPlacing) this.gameTime += dt;
    const t = this.gameTime;
    const bounds = { width: this.scale.width, height: this.effectiveHeight() };

    // 게임: placement 미리보기 — 매 프레임 다시 그려서 마우스 위치/시각 반영.
    if (isPlacing && this.placementHandle !== null) {
      this.placementHandle.update(0);
    }

    const allCells = this.whiteCellBehavior.getAll();
    const allBacteria = this.bacteriaBehavior.getAll();
    const liveCells = this.whiteCellBehavior.getAlive();
    const liveBacteria = this.bacteriaBehavior.getAlive();

    // 게임: 1) 시스템 갱신 (자원/풀/팀)
    this.shockwaveSystem.update(t);
    this.nutrientSystem.update(t);
    // 게임: 팀 갱신 — 영입/탈퇴/해체 + 모드 결정 (방어/공격).
    //         behavior 호출 전이라 같은 프레임에 모드 전환 즉시 반영.
    //         t 인자는 커맨더 사망 시각 기록용 (진화 트리거).
    this.teamSystem.update(allBacteria, allCells, t);

    // 게임: 커맨더 사망 후 일정 시간 경과 시 일반 세균 1마리 진화.
    this.evolveCommanders(t);

    // 게임: 레벨 도달한 호중구를 NK/BCELL/SUPER 중 무작위로 진화.
    this.evolveNeutrophils();

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
    // 게임: WhiteCellBehaviorSystem 은 Bacteria 객체 자체를 받아 isCommander 분기 (NK 용).
    this.whiteCellBehavior.update(dt, liveBacteria);
    this.bacteriaBehavior.update(t, dt, bounds, this.nutrientSystem, liveCells, this.teamSystem, this.antibodySystem);

    // 게임: 6) 백혈구 위치/렌더 갱신 (살아있는 것 + 시체 모두 — 시체는 내부에서 낙하 처리)
    for (const cell of allCells) cell.update(t, dt, bounds);

    // 게임: 7) 대식세포 — 침전된 시체 흡수 + 점수 누적. flatBottom 모드라 handle.y = cell 바닥.
    //   cursor 키 (← →) 매 프레임 검사 — isDown 이면 manualUntil 갱신. 자동/수동 분기는 MacrophageSystem.
    const macrophageFloorY = bounds.height;
    this.applyMacrophageManualInput(t);
    this.macrophageSystem.update(t, macrophageFloorY, dt, allCells, allBacteria, bounds.width);

    // 게임: 7b) 항체 시스템 — 위치 적분 + 사거리 만료 시 정지.
    //         WhiteCellBehaviorSystem 의 processBCellFiring 에서 spawn 됨.
    this.antibodySystem.update(dt);

    // 게임: 8) 점수 100 도달 시 호중구 생산. 대식세포 위에서 등장.
    //         호중구 사체 점수 ≥40 이면 슈퍼 호중구.
    this.tryProduceWhiteCell();

    // 게임: infected 세균 사망 시 페이즈 2 자동 진입 트리거 검사.
    //   cleanupAbsorbed 직전 — 시체가 풀에서 제거되기 전에 검사해야 killedByCell 사용 가능.
    this.checkInfectedKillTrigger();
    // 게임: corruption 호중구 소멸 시 페이즈 2 자동 진입 트리거. infected 와 동일하게 cleanupAbsorbed 직전.
    this.checkCorruptionTrigger();
    // 게임: hyperactive 호중구 폭발 트리거 — 반경 200px 즉사. cleanupAbsorbed 직전.
    this.checkHyperactiveTrigger();
    // 게임: paralysis 외부 전파 — 매 프레임. cell.update 직후 처리해야 paralyzed 효과 즉시 반영.
    this.checkParalysisPropagation(t);

    // 게임: 사운드 활성 — 사망 이벤트 + 접촉 멜로디 둘 다.
    //   멜로디는 playContact 의 시간 가드 + notifyContacts 한 프레임 1 trigger 로 프리징 방지.
    this.notifyDeaths();
    this.notifyContacts(dt);

    // 게임: 9) 흡수된 시체 정리 — 풀에서 제거 + 그래픽 핸들 destroy.
    this.cleanupAbsorbed();

    // 게임: 9a) 스테이지 — 세균 사망 카운트 갱신 + wave 자동 spawn + 결과 판정.
    //   placement / cutscene 단계는 stage 진행 X. running 일 때만 stage logic 호출.
    //   stage 시간 = gameTime - stageStartTime (cutscene 중 gameTime 진행되므로).
    this.bacteriaBehavior.pollKilled();
    // 게임: 영양분 리젠 배수 = 특전 (perk.nutrientRegenMul, 기본 1) × 동적 rule (세균 多 시 추가).
    //   매 프레임 갱신 — perk 누적 + 세균 임계 둘 다 반영. 둘 다 클수록 부활 느림 = 세균 약화.
    {
      let mul = getPerkState().nutrientRegenMul;
      if (this.nutrientRegenRule !== null) {
        const liveBac = this.bacteriaBehavior.getAlive().length;
        if (liveBac >= this.nutrientRegenRule.count) mul *= (1 / this.nutrientRegenRule.regenMul);
      }
      this.nutrientSystem.respawnDelayMul = mul;
    }
    if (this.phase === 'running') {
      const stageT = this.gameTime - this.stageStartTime;
      this.processStageWaves(stageT);
      this.checkStageResolution(stageT);
    }

    // 게임: 9b) 페이즈 2 풍선 갱신 — 외부 sim 과 동시. host 사망 시 자동 close.
    //   cleanupAbsorbed 후 호출 — host 가 isAbsorbed=true 면 isDead()=true 로 closeBubble.
    this.updateBubbles(dt);

    // 게임: 9) 시각화 — batch renderer 의 visible 플래그도 registry 반영.
    this.nutrientRenderer.draw(this.nutrientSystem.getAllSlots());
    this.nutrientRenderer.setVisible(this.entityRegistry.get('nutrient').visible);
    this.antibodyRenderer.draw(this.antibodySystem.getAll());
    this.antibodyRenderer.setVisible(this.entityRegistry.get('antibody').visible);
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
    this.fpsText.setText(
      isPlacing
        ? `FPS: ${this.game.loop.actualFps.toFixed(1)}  [PLACING]`
        : `FPS: ${this.game.loop.actualFps.toFixed(1)}  speed: ${this.speedMultiplier}x`,
    );
  }

  // 게임: 커맨더 진화 — 사망 후 COMMANDER_EVOLUTION_DELAY 초 경과 시
  //   살아있는 일반 세균 1마리를 무작위 선택해 커맨더로 변환.
  //   변환 = 기존 세균 isAbsorbed=true 로 정리 + 같은 위치에 새 BACTERIA_COMMANDER 생성.
  //   후보가 없으면 record 를 requeue — [B] 로 세균 스폰 시 다음 프레임 자동 재시도.
  private evolveCommanders(t: number): void {
    const expired = this.teamSystem.consumeExpiredDeathRecords(t, COMMANDER_EVOLUTION_DELAY);
    if (expired.length === 0) return;
    for (const deathTime of expired) {
      const candidates = this.bacteriaBehavior
        .getAlive()
        .filter((b) => !b.isCommander());
      if (candidates.length === 0) {
        // 게임: 세균 전멸 상태 — record 를 다시 큐에 넣어 다음 프레임 재시도.
        //        세균 스폰될 때까지 매 프레임 requeue/consume 반복 (비용 무시 가능).
        this.teamSystem.requeueDeathRecord(deathTime);
        continue;
      }
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const x = target.x;
      const y = target.y;
      target.isAbsorbed = true; // cleanupAbsorbed 에서 다음 프레임에 정리
      this.bacteriaBehavior.spawn(BACTERIA_COMMANDER, x, y, Math.random() * Math.PI * 2);
    }
  }

  // 게임: NEUTROPHIL 호중구 중 level 임계 도달한 개체를 NK/BCELL/SUPER 무작위 변환.
  //   - 변환 = 호중구 isAbsorbed=true (정리됨) + 같은 자리에 새 종 spawn
  //   - 1/3 씩 균등 분포 (NK / BCELL / SUPER)
  //   - 슈퍼/NK/BCELL/TCELL 등은 진화 X (`dnaKind === 'NEUTROPHIL'` 체크)
  // 게임: T세포 영역에서 level 5 도달한 호중구 → NK/BCELL/SUPER 중 가중 추첨 진화.
  //   가중치 = registry.<kind>.spawnProb (디폴트 1 → 1/3 균등). 0 이면 그 종은 후보 제외.
  //   세 종 모두 spawnProb=0 이면 진화 skip — 호중구 그대로 (cell.isAbsorbed 안 함).
  private evolveNeutrophils(): void {
    const candidates = this.whiteCellBehavior
      .getAlive()
      .filter((c) => c.dnaKind === 'NEUTROPHIL' && c.level >= NEUTROPHIL_EVOLUTION_LEVEL);
    if (candidates.length === 0) return;
    for (const cell of candidates) {
      const x = cell.x;
      const y = cell.y;
      const wNk    = this.entityRegistry.get('nk').spawnProb;
      const wBcell = this.entityRegistry.get('bcell').spawnProb;
      const wSuper = this.entityRegistry.get('neutrophilSuper').spawnProb;
      const total = wNk + wBcell + wSuper;
      if (total <= 0) continue;  // 모두 0 → 진화 skip, 호중구 그대로
      const r = Math.random() * total;
      const dna = r < wNk ? NK_CELL : r < wNk + wBcell ? BCELL : NEUTROPHIL_SUPER;
      cell.isAbsorbed = true;
      const phase = Math.random() * Math.PI * 2;
      this.whiteCellBehavior.spawn(dna, x, y, phase);
    }
  }

  // 게임: 흡수된 시체 정리. 매 프레임 update 끝에 호출.
  private cleanupAbsorbed(): void {
    this.whiteCellBehavior.removeAbsorbed();
    this.bacteriaBehavior.removeAbsorbed();
  }

  // 게임: 호중구↔세균 접촉 중 멜로디 "딩" 확률 trigger.
  //   매 페어 매 프레임 (dt × TRIGGER_RATE) 확률. 한 프레임 최대 1번만 — cacophony 방지 +
  //   Tone.js voice 누적 차단 (PluckSynth 가 짧은 시간에 다수 trigger 시 메인 스레드 부담).
  //   격렬 전투 (페어 N개) 라도 한 프레임 1 trigger → 자연 빈도 (페어 늘면 검출만 빨라짐).
  private notifyContacts(dt: number): void {
    const TRIGGER_RATE = 1.0;  // 페어 당 초당 평균 trigger 수 (전엔 2.5 — 부담 줄임)
    const triggerProb = dt * TRIGGER_RATE;
    const whiteCells = this.whiteCellBehavior.getAll();
    const bacteria = this.bacteriaBehavior.getAll();
    for (const w of whiteCells) {
      if (w.isDead()) continue;
      const wr = w.dna.shape.base;
      for (const b of bacteria) {
        if (b.isDead()) continue;
        const dx = b.x - w.x;
        const dy = b.y - w.y;
        const minDist = wr + b.dna.shape.base;
        if (dx * dx + dy * dy >= minDist * minDist) continue;
        if (Math.random() < triggerProb) {
          this.soundSystem.playContact();
          return;  // 한 프레임 한 번만
        }
      }
    }
  }

  // 게임: 새 사망 (hp 0 도달) 검출 → 종족별 사운드 트리거. WeakSet 으로 중복 방지.
  //   백혈구 모든 종 (NEUTROPHIL/NK/BCELL/TCELL/SUPER) — playWhiteCellDeath
  //   세균 모든 종 (BACTERIA_A/COMMANDER) — playBacteriaDeath
  //   fusion 흡수 (isAbsorbed=true 인데 hp>0) 는 사망 아님 — 사운드 X.
  private notifyDeaths(): void {
    for (const c of this.whiteCellBehavior.getAll()) {
      if (c.isDead() && !this.deadNotified.has(c)) {
        this.deadNotified.add(c);
        this.soundSystem.playWhiteCellDeath();
      }
    }
    for (const b of this.bacteriaBehavior.getAll()) {
      if (b.isDead() && !this.deadNotified.has(b)) {
        this.deadNotified.add(b);
        this.soundSystem.playBacteriaDeath();
      }
    }
  }

  // 게임: 대식세포 점수 100 도달 시 호중구 생산.
  //   - 슈퍼 조건 만족(호중구 점수 ≥ 40): NEUTROPHIL_SUPER
  //   - 아니면: NEUTROPHIL
  //   - **위치: 대식세포 정확한 위치 + 위로 솟구치는 임펄스** — "분리되어 나오는" 효과.
  //     마찰(1.5/sec)로 약 1초 후 멈춤.
  //   - 한 프레임에 여러 번 발동 가능 (점수 충분 시 연속 생산)
  private tryProduceWhiteCell(): void {
    const macrophages = this.macrophageSystem.getAll();
    if (macrophages.length === 0) return;

    let result = this.macrophageSystem.consumeScoreForProduction();
    while (result !== null) {
      const m = macrophages[0];
      const dna =
        result.kind === 'nk' ? NK_CELL :
        result.kind === 'super' ? NEUTROPHIL_SUPER :
        NEUTROPHIL;
      const phase = Math.random() * Math.PI * 2;
      const cell = this.whiteCellBehavior.spawn(dna, m.x, m.y, phase);
      // 게임: 대식세포에서 위로 분리되는 효과. 좌우 약간 무작위.
      //   spawn() 이 null 반환 시 (registry enabled=false) skip.
      if (cell !== null) {
        cell.vy = -180;
        cell.vx = (Math.random() - 0.5) * 80;
      }
      result = this.macrophageSystem.consumeScoreForProduction();
    }
  }
}

// 게임: Fisher-Yates shuffle. wave 패턴 큐 순서 무작위화 (in-place).
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
