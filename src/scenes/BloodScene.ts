// 장면 1: 혈관 속 (매크로 뷰).
// M1.5: 호중구 N마리 + 충격파 인터렉션
// M2.1: + 영양분 풀(40, 4초 리젠) + 세균 (영양분 추적, 분열) — 백혈구는 아직 관전
// M2.2: + drives(우선순위) + 관성 + 동족 분리력

import Phaser from 'phaser';
import { NEUTROPHIL, NEUTROPHIL_SUPER, NK_CELL, BCELL, TCELL, BACTERIA_A, BACTERIA_COMMANDER, MACROPHAGE } from '../domain/dna';
import { WhiteCell } from '../entities/WhiteCell';
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
import { STAGE_1, type StageConfig, type StageResult } from '../stages/types';
import { CUTSCENE_INTRO } from '../cutscenes/intro-script';
import type { CutsceneStep } from '../cutscenes/types';

// 게임: 초기 spawn 수는 Session 20 부터 StageConfig 로 이전 (src/stages/types.ts).
//   COMMANDER_COUNT 는 placement queue 의 의미로만 (사용자가 클릭으로 1마리 배치) — 상수 유지.
const COMMANDER_COUNT = 1;

// 게임: 초기 대식세포 수 (M5.4a).
const MACROPHAGE_COUNT = 1;

// 게임: 초기 B세포 수 (M7).
const BCELL_COUNT = 1;

// 게임: 초기 T세포 수 (M7). 복수화는 추후.
const TCELL_COUNT = 1;

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
const NUTRIENT_RESPAWN_DELAY = 5;

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
// 게임: 컷신 ACTION step placeholder 시간 (초). Stage A 는 모든 action 이 3s 자동 진행.
//   Stage B 에서 kind 별 실제 시간/조건으로 교체.
const CUTSCENE_ACTION_PLACEHOLDER_DURATION = 3;

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
  private hudText!: Phaser.GameObjects.Text;
  private fpsText!: Phaser.GameObjects.Text;
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
  // 게임: 컷신 ACTION 중 sim 활성 여부 (Session 21 Stage B). spawnBacteria/spawnNeutrophils 만 true.
  private cutsceneSimActive = false;
  // 게임: spawnNutrients ACTION 의 sub-phase ('spawning' / 'pause' / 'sparkling').
  private cutsceneNutPhase = '';
  private cutsceneNutSpawned = 0;
  private cutsceneNutPositions: { x: number; y: number }[] = [];
  private cutsceneSparkleGfx: Phaser.GameObjects.Graphics | null = null;
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
  //   currentStage    — 현재 활성 스테이지 config (스폰/판정 기준).
  //   stageState      — running 중 / 결과 표시 중 / 종료. 결과 후 sim 정지.
  //   nextWaveIndex   — bacteriaWaves 의 다음 처리할 인덱스. 매 프레임 atSec 도달 검사.
  //   stageResult     — 평가 결과 (결과 모달 표시용). null = 진행 중.
  //   stageResultText — 결과 모달 텍스트 객체 (생성 시 lazy).
  private currentStage: StageConfig = STAGE_1;
  private stageState: 'running' | 'resolved' = 'running';
  private nextWaveIndex = 0;
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

  // Phaser: 씬 시작 시 1회 호출.
  create(): void {
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
    const H = this.scale.height;

    this.cellRenderer = new GraphicsCellRenderer(this);
    this.shockwaveRenderer = new ShockwaveRenderer(this);
    this.nutrientRenderer = new NutrientRenderer(this);
    this.antibodyRenderer = new AntibodyRenderer(this);

    this.shockwaveSystem = new ShockwaveSystem({
      ...SHOCKWAVE_CONFIG,
      initialTime: 0,  // 가상 시간 시작점
    });
    this.nutrientSystem = new NutrientSystem(
      NUTRIENT_COUNT,
      { width: W, height: H, margin: NUTRIENT_MARGIN },
      NUTRIENT_RESPAWN_DELAY,
    );
    this.antibodySystem = new AntibodySystem(ANTIBODY_MAX_STOPPED);
    this.bacteriaBehavior = new BacteriaBehaviorSystem(this.cellRenderer);
    this.whiteCellBehavior = new WhiteCellBehaviorSystem(this.cellRenderer, this.antibodySystem);
    this.contactSystem = new ContactSystem();
    this.teamSystem = new TeamSystem();
    this.macrophageSystem = new MacrophageSystem();

    // 게임: 스테이지 상태 초기화 (Session 20). restart 시에도 첫 스테이지부터.
    this.currentStage = STAGE_1;
    this.stageState = 'running';
    this.nextWaveIndex = 0;
    this.stageStartTime = 0;
    this.bacteriaBehavior.resetStageCounters();

    // 게임: 스테이지 시작 spawn (호중구/세균/대식세포) 은 컷신 종료 시점 (endCutscene) 으로 미룸.
    //   컷신 도중 호중구가 보이면 안 됨 — populateStageStart() 가 endCutscene 에서 호출.

    // 게임: 주요 캐릭 (T세포 / 세균 커맨더 / B세포) placement queue 만 등록.
    //        beginNextPlacement 호출은 placementText 생성 후로 미룸 (setText undefined 회피).
    this.placementQueue = [
      { dna: TCELL, label: 'T세포 (대장세포)' },
      { dna: BACTERIA_COMMANDER, label: '세균 커맨더' },
      { dna: BCELL, label: 'B세포' },
    ];
    void TCELL_COUNT; void COMMANDER_COUNT; void BCELL_COUNT; // 상수 보존, 미사용 회피

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
      if (this.phase === 'cutscene') {
        this.handleCutsceneClick();
        return;
      }
      if (this.phase === 'placing') {
        this.confirmPlacement(pointer.x, pointer.y);
        return;
      }
      if (this.phase !== 'running') return;
      // 게임: 풍선 영역 클릭 = (개입 모드) 그 풍선 쉴드 발동. (관전 모드) 무시 + 충격파도 X.
      //   외부 클릭 = 충격파 그대로. 여러 풍선 겹치면 위 풍선 (배열 뒤쪽) 우선.
      for (let i = this.bubbles.length - 1; i >= 0; i--) {
        const b = this.bubbles[i];
        if (this.isPointInBubble(pointer.x, pointer.y, b)) {
          if (this.interactive) this.tryActivateBubbleShield(b);
          return;
        }
      }
      this.shockwaveSystem.trySpawn(pointer.x, pointer.y, this.gameTime);
    });

    this.add.text(20, 20, 'M7: T세포 + 호중구 진화 (level 5 → NK/B/SUPER)', {
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
    this.add.text(20, 80, '[N]+호중구10  [B]+세균10  [P]일시정지  [R]리셋  [1/2/3] 1x/2x/4x  [←→]대식세포  [I]개입/관전  [M]무작위변이  [Shift+1~6]변이1~6  [Z]풍선', {
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

    // 게임: 컷신 시작 (Session 21). create 끝 — UI 텍스트 등 모두 만들어진 후.
    //   컷신 끝나면 자동으로 beginNextPlacement 호출 (advanceCutsceneStep 의 end 처리).
    //   영양분 시스템 frozen + disableAll — 컷신 동안 spawnAt 5개 외 어떤 영양분도 등장 X.
    //   세균이 영양분 흡수해도 frozen 이라 부활 차단.
    this.nutrientSystem.frozen = true;
    this.nutrientSystem.disableAll();
    this.beginCutscene();

    // Phaser: 디버그 키. scene.restart() 시 자동 정리되고 create 에서 재등록.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-N', () => this.spawnNeutrophils(10));
      kb.on('keydown-B', () => this.spawnBacteria(10));
      kb.on('keydown-P', () => { this.paused = !this.paused; });
      kb.on('keydown-R', () => this.scene.restart());
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
      // 게임: [ESC] 컷신 진행 중이면 스킵 → placing 으로 전환.
      kb.on('keydown-ESC', () => {
        if (this.phase === 'cutscene') this.endCutscene();
      });
      // 게임: [I] 페이즈 2 인터렉션 모드 토글. 디폴트 관전, 토글 시 개입.
      kb.on('keydown-I', () => {
        this.interactive = !this.interactive;
        console.log('[mode]', this.interactive ? 'INTERACTIVE' : 'OBSERVE');
      });
    }
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
    this.cutsceneSimActive = false;
    this.cutsceneNutPhase = '';
    this.cutsceneNutSpawned = 0;
    this.cutsceneNutPositions = [];
    this.createCutsceneUI();
    console.log('[cutscene] begin, steps=', this.cutsceneSteps.length);
    this.applyCutsceneStep();
  }

  // 게임: 컷신 UI 생성 — 화면 위쪽에 텍스트 박스 (둥근 사각형 배경 + 텍스트 + 클릭 힌트).
  //   레이아웃: 좌우 마진 30, 박스 높이 260 (텍스트 5~6 라인 + 여백), 상단 18% 위치.
  //   위쪽 배치 = 아래쪽 객체 (spawn 되는 호중구/세균/영양분) 가 텍스트 박스 가려지지 X.
  private createCutsceneUI(): void {
    const W = this.scale.width;
    const H = this.scale.height;
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

    const text = this.add.text(W / 2, boxY + boxH / 2, '', {
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

  // 게임: 컷신 종료 — UI 제거 + 영양분 enableAll + 시작 spawn + placement 진입.
  //   세균 frozen 도 해제. cutsceneSimActive false. populateStageStart 가 호중구/세균/대식세포 등장.
  private endCutscene(): void {
    if (this.phase !== 'cutscene') return;
    console.log('[cutscene] end');
    this.destroyCutsceneUI();
    this.cutsceneSimActive = false;
    this.bacteriaBehavior.frozen = false;
    this.cutsceneSparkleGfx?.destroy();
    this.cutsceneSparkleGfx = null;
    this.nutrientSystem.setSpawnBox(null);  // 화면 전체 부활 영역 복원.
    this.nutrientSystem.frozen = false;
    this.nutrientSystem.enableAll();
    this.populateStageStart();
    this.beginNextPlacement(this.scale.width, this.scale.height);
  }

  // 게임: 스테이지 시작 spawn — 호중구/세균/대식세포. 컷신 종료 시점에 1회 호출.
  //   컷신 중에 spawn 한 세균 (spawnBacteria 액션) 은 그대로 유지 — 분열한 자식 포함 게임에 잔류.
  //   호중구는 컷신 중에 spawn 된 게 있을 수 있음 (spawnNeutrophils 액션). 이건 그대로 유지.
  private populateStageStart(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    for (let i = 0; i < this.currentStage.startNeutrophils; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      const hp = NEUTROPHIL.combat.maxHp * (0.6 + Math.random() * 0.4);
      this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, phase, hp));
    }
    for (let i = 0; i < this.currentStage.startBacteria; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      const hp = BACTERIA_A.combat.maxHp * (0.6 + Math.random() * 0.4);
      this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase, hp);
    }
    const floorY = H - MACROPHAGE.shape.base * 0.55;
    for (let i = 0; i < MACROPHAGE_COUNT; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      this.macrophageSystem.add(new Macrophage(MACROPHAGE, this.cellRenderer, x, floorY, phase));
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
    if (step.type === 'narration') {
      this.cutsceneLineIndex = 0;
      this.cutsceneWordIndex = 0;
      this.cutsceneWordTimer = CUTSCENE_WORD_INTERVAL;
      this.cutsceneLinePause = 0;
      this.cutsceneAwaitingClick = false;
      this.showCutsceneUI();
      this.cutsceneUiText?.setText('');
      this.cutsceneUiHint?.setAlpha(0);
      this.cutsceneSimActive = false;
      this.bacteriaBehavior.frozen = false;
    } else {
      // 게임: ACTION 진입 — 텍스트 박스 숨김, kind 별 셋업.
      this.cutsceneActionTimer = 0;
      this.cutsceneAwaitingClick = false;
      this.hideCutsceneUI();
      this.applyCutsceneAction(step.kind);
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

  // 게임: ACTION kind 별 진입 셋업 (Session 21 Stage B).
  //   spawnNutrients   : sim 정지. sub-phase 'spawning' 으로 진입, 0.5s 간격 5개 spawn.
  //   spawnBacteria    : sim 활성. 화면 중앙 2 세균 spawn. 영양분 active=0 시 종료.
  //   spawnNeutrophils : sim 활성 + 세균 frozen. 호중구 3 spawn. live cells/bacteria 0 시 종료.
  private applyCutsceneAction(kind: string): void {
    const W = this.scale.width;
    const H = this.scale.height;
    if (kind === 'spawnNutrients') {
      this.cutsceneSimActive = false;
      this.cutsceneNutPhase = 'spawning';
      this.cutsceneNutSpawned = 0;
      this.cutsceneNutPositions = [];
      this.cutsceneActionTimer = 0;  // 다음 spawn 까지 elapsed
      return;
    }
    if (kind === 'spawnBacteria') {
      this.cutsceneSimActive = true;
      this.bacteriaBehavior.frozen = false;
      // 게임: 중앙 ±40 박스 안 2마리 spawn. 자동 영양분 흡수 행동.
      for (let i = 0; i < 2; i++) {
        const x = W / 2 + (Math.random() - 0.5) * 80;
        const y = H / 2 + (Math.random() - 0.5) * 80;
        const phase = Math.random() * Math.PI * 2;
        this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
      }
      return;
    }
    if (kind === 'spawnNeutrophils') {
      this.cutsceneSimActive = true;
      this.bacteriaBehavior.frozen = true;  // 세균 정지
      // 게임: 호중구 1마리 — 화면 중앙 (세균/영양분 위치). 자동으로 가까운 세균 추적.
      this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, W / 2, H / 2, Math.random() * Math.PI * 2));
      return;
    }
    if (kind === 'reinforcement') {
      this.cutsceneSimActive = true;
      this.bacteriaBehavior.frozen = false;  // 세균 정지 해제 — 영양분 추격 시작
      // 게임: 영양분 지속 리젠 — 백혈구 centroid 근처 박스로 spawn 영역 제한. 흡수돼도 같은 박스에 부활.
      //   세균이 영양분 먹으려면 백혈구 영역에 진입 → 자연 접촉/전투 발생.
      const live = this.whiteCellBehavior.getAlive();
      let cx = W / 2, cy = H / 2;
      if (live.length > 0) {
        cx = live.reduce((s, c) => s + c.x, 0) / live.length;
        cy = live.reduce((s, c) => s + c.y, 0) / live.length;
      }
      this.nutrientSystem.setSpawnBox({ cx, cy, half: 80 });
      this.nutrientSystem.frozen = false;
      this.nutrientSystem.disableAll();
      // 게임: 6개만 활성 (인덱스 0~5). 나머지 슬롯은 비활성. 흡수돼도 같은 box 안 새 위치에 부활.
      for (let i = 0; i < 6; i++) this.nutrientSystem.spawnAt(i, cx + (Math.random() * 2 - 1) * 80, cy + (Math.random() * 2 - 1) * 80);
      // 게임: 세균 5 + 커맨더 1 추가 — 커맨더가 팀 영입/공격 모드 결정. 백혈구 처치 가능성 ↑.
      for (let i = 0; i < 5; i++) {
        const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
        const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
        this.bacteriaBehavior.spawn(BACTERIA_A, x, y, Math.random() * Math.PI * 2);
      }
      // 게임: 커맨더는 직접 spawn 하지 않고 진화 시스템에 위임 — 자연 등장.
      //   requeueDeathRecord 에 fake deathTime 등록 → COMMANDER_EVOLUTION_DELAY (10s) 후 자동 진화.
      //   5초 후 등장하려면 deathTime = gameTime - 5 (t - deathTime = 5 + 5 = 10 도달).
      const evolveAfter = 5;  // 초 (보강 시작 이만큼 후 일반 세균 중 1마리가 커맨더로).
      this.teamSystem.requeueDeathRecord(this.gameTime - (COMMANDER_EVOLUTION_DELAY - evolveAfter));
      // 게임: 호중구 2 추가.
      for (let i = 0; i < 2; i++) {
        const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
        const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
        this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, Math.random() * Math.PI * 2));
      }
      return;
    }
    console.warn('[cutscene] unknown action kind:', kind);
  }

  // 게임: 매 프레임 컷신 진행 — dt 기준. real time (Phaser delta) 사용 (gameTime 정지 무관).
  private updateCutscene(dtReal: number): void {
    if (this.cutsceneStepIndex >= this.cutsceneSteps.length) return;
    const step = this.cutsceneSteps[this.cutsceneStepIndex];

    if (step.type === 'narration') {
      this.updateCutsceneNarration(step.lines, dtReal);
    } else if (step.type === 'action') {
      this.updateCutsceneAction(step.kind, dtReal);
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

  // 게임: action step 진행 (Session 21 Stage B). kind 별 분기.
  private updateCutsceneAction(kind: string, dtReal: number): void {
    if (kind === 'spawnNutrients') {
      this.updateCutsceneSpawnNutrients(dtReal);
      return;
    }
    if (kind === 'spawnBacteria') {
      this.updateCutsceneSpawnBacteria(dtReal);
      return;
    }
    if (kind === 'spawnNeutrophils') {
      this.updateCutsceneSpawnNeutrophils(dtReal);
      return;
    }
    if (kind === 'reinforcement') {
      this.updateCutsceneReinforcement(dtReal);
      return;
    }
    // unknown — placeholder 처럼 3s 후 진행.
    this.cutsceneActionTimer += dtReal;
    if (this.cutsceneActionTimer >= CUTSCENE_ACTION_PLACEHOLDER_DURATION) this.advanceCutsceneStep();
  }

  // 게임: 영양분 5개 순차 spawn → pause → sparkle.
  //   spawning : 0.5s 간격 5번 spawnAt. 위치는 화면 중앙 ±60 무작위 (모여있게).
  //   pause    : 5번째 후 0.6s 정지.
  //   sparkling: 1s 동안 원 펄스 (반지름↑ + alpha↓).
  private updateCutsceneSpawnNutrients(dtReal: number): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.cutsceneActionTimer += dtReal;
    if (this.cutsceneNutPhase === 'spawning') {
      const TARGET_COUNT = 5;
      const SPAWN_INTERVAL = 0.5;
      const nextSpawnAt = this.cutsceneNutSpawned * SPAWN_INTERVAL;
      if (this.cutsceneActionTimer >= nextSpawnAt && this.cutsceneNutSpawned < TARGET_COUNT) {
        const x = W / 2 + (Math.random() - 0.5) * 120;
        const y = H / 2 + (Math.random() - 0.5) * 120;
        this.nutrientSystem.spawnAt(this.cutsceneNutSpawned, x, y);
        this.cutsceneNutPositions.push({ x, y });
        this.cutsceneNutSpawned++;
      }
      if (this.cutsceneNutSpawned >= TARGET_COUNT) {
        this.cutsceneNutPhase = 'pause';
        this.cutsceneActionTimer = 0;
      }
      return;
    }
    if (this.cutsceneNutPhase === 'pause') {
      if (this.cutsceneActionTimer >= 0.6) {
        this.cutsceneNutPhase = 'sparkling';
        this.cutsceneActionTimer = 0;
        this.cutsceneSparkleGfx = this.add.graphics();
        this.cutsceneSparkleGfx.setDepth(BUBBLE_DEPTH + 19);
      }
      return;
    }
    if (this.cutsceneNutPhase === 'sparkling') {
      const DURATION = 1.0;
      const tt = Math.min(1, this.cutsceneActionTimer / DURATION);
      const gfx = this.cutsceneSparkleGfx;
      if (gfx) {
        gfx.clear();
        const r = 8 + tt * 24;
        const alpha = 1 - tt;
        gfx.lineStyle(2, 0xffff88, alpha);
        for (const p of this.cutsceneNutPositions) gfx.strokeCircle(p.x, p.y, r);
      }
      if (tt >= 1) {
        gfx?.destroy();
        this.cutsceneSparkleGfx = null;
        this.advanceCutsceneStep();
      }
      return;
    }
  }

  // 게임: 세균 자동 행동 (영양분 흡수 + 분열). 영양분 active=0 또는 maxTime 15s 시 종료.
  private updateCutsceneSpawnBacteria(dtReal: number): void {
    this.cutsceneActionTimer += dtReal;
    const MAX_TIME = 15;
    if (this.nutrientSystem.getActiveCount() === 0 || this.cutsceneActionTimer >= MAX_TIME) {
      this.advanceCutsceneStep();
    }
  }

  // 게임: 호중구 vs 정지 세균. 살아있는 호중구 0 또는 살아있는 세균 0 또는 maxTime 시 종료.
  private updateCutsceneSpawnNeutrophils(dtReal: number): void {
    this.cutsceneActionTimer += dtReal;
    const MAX_TIME = 15;
    const liveBacteria = this.bacteriaBehavior.getAlive().length;
    const liveCells = this.whiteCellBehavior.getAlive().length;
    if (liveBacteria === 0 || liveCells === 0 || this.cutsceneActionTimer >= MAX_TIME) {
      this.bacteriaBehavior.frozen = false;
      this.advanceCutsceneStep();
    }
  }

  // 게임: 보강 — 세균 + 커맨더 vs 호중구. 백혈구 (NEUTROPHIL/NK/SUPER) 전멸 시 종료.
  //   maxTime 30s 안전망 — 호중구가 안 죽으면 자동 진행.
  private updateCutsceneReinforcement(dtReal: number): void {
    this.cutsceneActionTimer += dtReal;
    const MAX_TIME = 30;
    const liveNeutrophils = this.whiteCellBehavior.getAlive().filter((c) =>
      c.dnaKind === 'NEUTROPHIL' || c.dnaKind === 'NK_CELL' || c.dnaKind === 'NEUTROPHIL_SUPER',
    ).length;
    if (liveNeutrophils === 0 || this.cutsceneActionTimer >= MAX_TIME) {
      this.advanceCutsceneStep();
    }
  }

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
    if (step.type !== 'narration') return;

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
      this.whiteCellBehavior.add(new WhiteCell(slot.dna, this.cellRenderer, x, y, phase));
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

  // 게임: 스테이지 wave 스케줄 — gameTime 도달한 wave 자동 spawn (Session 20).
  //   nextWaveIndex 부터 순차 검사 (배열은 atSec 오름차순 가정).
  private processStageWaves(t: number): void {
    const waves = this.currentStage.bacteriaWaves;
    const W = this.scale.width;
    const H = this.scale.height;
    while (this.nextWaveIndex < waves.length) {
      const w = waves[this.nextWaveIndex];
      if (t < w.atSec) break;
      console.log('[stage wave]', this.nextWaveIndex, 'atSec=', w.atSec, '+bacteria=', w.bacteria, '+commander=', w.commander ?? 0);
      for (let i = 0; i < w.bacteria; i++) {
        const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
        const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
        const phase = Math.random() * Math.PI * 2;
        this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
      }
      for (let i = 0; i < (w.commander ?? 0); i++) {
        const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
        const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
        const phase = Math.random() * Math.PI * 2;
        this.bacteriaBehavior.spawn(BACTERIA_COMMANDER, x, y, phase);
      }
      this.nextWaveIndex++;
    }
  }

  // 게임: 스테이지 결과 판정 — 매 프레임 호출. 한 번 resolved 되면 무시.
  //   1) 호중구 (NEUTROPHIL/NK/SUPER) 전멸 → 즉시 패배 (★0).
  //   2) wave 다 처리 + 세균 0 → 시간 클리어 (★3).
  //   3) gameTime >= timeLimit → 시간 초과. 비율로 ★2/★1/실패.
  private checkStageResolution(t: number): void {
    if (this.stageState !== 'running') return;
    const stage = this.currentStage;
    const spawned = this.bacteriaBehavior.getStageSpawned();
    const killed = this.bacteriaBehavior.getStageKilled();
    // 게임: 호중구 = NEUTROPHIL / NK_CELL / NEUTROPHIL_SUPER. T/B 는 보조라 전투 능력 X.
    const liveNeutrophils = this.whiteCellBehavior.getAlive().filter((c) =>
      c.dnaKind === 'NEUTROPHIL' || c.dnaKind === 'NK_CELL' || c.dnaKind === 'NEUTROPHIL_SUPER',
    );
    if (liveNeutrophils.length === 0) {
      this.resolveStage({ kind: 'wipe', stars: 0, killed, total: spawned, elapsedSec: t });
      return;
    }
    const allWavesProcessed = this.nextWaveIndex >= stage.bacteriaWaves.length;
    const liveBacteria = this.bacteriaBehavior.getAlive().length;
    if (allWavesProcessed && liveBacteria === 0 && spawned > 0) {
      this.resolveStage({ kind: 'clear', stars: 3, killed, total: spawned, elapsedSec: t });
      return;
    }
    if (t >= stage.timeLimit) {
      const ratio = spawned > 0 ? Math.min(1, killed / spawned) : 0;
      let stars: 0 | 1 | 2 = 0;
      if (ratio >= stage.starTwoRatio) stars = 2;
      else if (ratio >= stage.starOneRatio) stars = 1;
      this.resolveStage({ kind: 'timeout', stars, killed, total: spawned });
    }
  }

  // 게임: 결과 set + 모달 표시. stageState='resolved' 로 sim 정지 (update 안 분기 처리).
  //   결과 모달 (scene.restart 시 자동 destroy) — 명시 ref 안 보유.
  private resolveStage(result: StageResult): void {
    this.stageState = 'resolved';
    console.log('[stage resolved]', result);
    const W = this.scale.width;
    const H = this.scale.height;
    const starChars = result.stars >= 1 ? '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars) : '실패';
    const headline =
      result.kind === 'clear' ? '시간 클리어!' :
      result.kind === 'wipe'  ? '호중구 전멸' :
      '시간 종료';
    const body = `${headline}\n${starChars}\n잡은 세균 ${result.killed}/${result.total}\n[R] 재시작`;
    const text = this.add.text(W / 2, H / 2, body, {
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
    const H = this.scale.height;
    for (let i = 0; i < count; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, phase));
    }
  }

  // 게임: [B] 디버그 — 처음 2마리는 강제 infected 로 검증 편의 (Stage 11 페이즈 2 트리거).
  //   분열 시 10% 와는 별개. 사용자 검증용.
  private spawnBacteria(count: number): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const FORCE_INFECTED_PREFIX = 2;
    for (let i = 0; i < count; i++) {
      const x = SPAWN_MARGIN + Math.random() * (W - SPAWN_MARGIN * 2);
      const y = SPAWN_MARGIN + Math.random() * (H - SPAWN_MARGIN * 2);
      const phase = Math.random() * Math.PI * 2;
      const b = this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
      if (i < FORCE_INFECTED_PREFIX) b.setInfected();
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
        this.stageHudText.setText(`${this.currentStage.name}  ⏱ ${mm}:${ss}   세균 ${killed}/${spawned}`);
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

    // 게임: 컷신 진행 — 텍스트박스/단어 타이핑/click 처리.
    //   action 진행 중 cutsceneSimActive=true 면 일반 sim 으로 fall-through (세균/호중구 자동 행동).
    //   cutsceneSimActive=false (narration 또는 spawnNutrients) 면 sim 정지하되 영양분 렌더링은 필요.
    if (this.phase === 'cutscene') {
      this.updateCutscene(delta / 1000);
      this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  [CUTSCENE]`);
      if (!this.cutsceneSimActive) {
        // 게임: spawnNutrients 등 sim 정지 액션 — 영양분 (별) 시각만 매 프레임 그림.
        this.nutrientRenderer.draw(this.nutrientSystem.getAllSlots());
        return;
      }
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
    const bounds = { width: this.scale.width, height: this.scale.height };

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

    // 게임: 7) 대식세포 — 침전된 시체 흡수 + 점수 누적. 납작 비율 0.55 반영.
    //   cursor 키 (← →) 매 프레임 검사 — isDown 이면 manualUntil 갱신. 자동/수동 분기는 MacrophageSystem.
    const macrophageFloorY = bounds.height - MACROPHAGE.shape.base * 0.55;
    this.applyMacrophageManualInput(t);
    this.macrophageSystem.update(t, macrophageFloorY, dt, allCells, allBacteria);

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

    // 게임: 9) 흡수된 시체 정리 — 풀에서 제거 + 그래픽 핸들 destroy.
    this.cleanupAbsorbed();

    // 게임: 9a) 스테이지 — 세균 사망 카운트 갱신 + wave 자동 spawn + 결과 판정.
    //   placement / cutscene 단계는 stage 진행 X. running 일 때만 stage logic 호출.
    //   stage 시간 = gameTime - stageStartTime (cutscene 중 gameTime 진행되므로).
    this.bacteriaBehavior.pollKilled();
    if (this.phase === 'running') {
      const stageT = this.gameTime - this.stageStartTime;
      this.processStageWaves(stageT);
      this.checkStageResolution(stageT);
    }

    // 게임: 9b) 페이즈 2 풍선 갱신 — 외부 sim 과 동시. host 사망 시 자동 close.
    //   cleanupAbsorbed 후 호출 — host 가 isAbsorbed=true 면 isDead()=true 로 closeBubble.
    this.updateBubbles(dt);

    // 게임: 9) 시각화
    this.nutrientRenderer.draw(this.nutrientSystem.getAllSlots());
    this.antibodyRenderer.draw(this.antibodySystem.getAll());
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
  private evolveNeutrophils(): void {
    const candidates = this.whiteCellBehavior
      .getAlive()
      .filter((c) => c.dnaKind === 'NEUTROPHIL' && c.level >= NEUTROPHIL_EVOLUTION_LEVEL);
    if (candidates.length === 0) return;
    for (const cell of candidates) {
      const x = cell.x;
      const y = cell.y;
      cell.isAbsorbed = true;
      const r = Math.random();
      const dna = r < 1 / 3 ? NK_CELL : r < 2 / 3 ? BCELL : NEUTROPHIL_SUPER;
      const phase = Math.random() * Math.PI * 2;
      this.whiteCellBehavior.add(new WhiteCell(dna, this.cellRenderer, x, y, phase));
    }
  }

  // 게임: 흡수된 시체 정리. 매 프레임 update 끝에 호출.
  private cleanupAbsorbed(): void {
    this.whiteCellBehavior.removeAbsorbed();
    this.bacteriaBehavior.removeAbsorbed();
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
      const cell = new WhiteCell(dna, this.cellRenderer, m.x, m.y, phase);
      // 게임: 대식세포에서 위로 분리되는 효과. 좌우 약간 무작위.
      cell.vy = -180;
      cell.vx = (Math.random() - 0.5) * 80;
      this.whiteCellBehavior.add(cell);
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
