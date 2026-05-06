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
import { evaluateRadius } from '../domain/shapeFunction';

// 게임: 초기 호중구 수.
const NEUTROPHIL_COUNT = 10;

// 게임: 초기 세균 수. 시스템 구현 기획서 §2.4 — 사회성 형질 도입 시 즉시 관찰 가능.
const BACTERIA_COUNT = 3;

// 게임: 초기 커맨더 수 (M5.1). 분열 안 하므로 사망 시까지 유지.
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
//       세균이 구석에 쏠리지 않도록 충분히 안쪽 (100px).
const NUTRIENT_MARGIN = 100;
const NUTRIENT_RESPAWN_DELAY = 4;

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
  private paused = false;
  // 게임: 가상 시간 + 빨리감기. Phaser 의 this.time.now 대신 사용.
  //        speedMultiplier 1=정상, 2=2배, 4=4배. update 에서 dt 에 곱.
  private gameTime = 0;
  private speedMultiplier = 1;

  // 게임: 게임 단계.
  //   placing    — 주요 캐릭 (T세포/세균커맨더/B세포) 마우스 배치 중. 시뮬레이션 정지.
  //   running    — 정상 혈관 뷰 시뮬레이션.
  //   zoomingIn  — [Z] 후 호중구로 카메라 줌인 중. 입력/시뮬레이션 정지.
  //   inside     — 세포 내부 phase. 외부 시뮬레이션 정지, 내부 시뮬레이션만 진행.
  //   zoomingOut — 내부에서 ESC 후 카메라 원위치 중. 입력/시뮬레이션 정지.
  private phase: 'placing' | 'running' | 'zoomingIn' | 'inside' | 'zoomingOut' = 'placing';

  // 게임: 세포 내부 phase 관련 상태.
  //   outerLayer  — 모든 혈관 뷰 GameObject 가 들어가는 레이어. cam2 가 ignore.
  //   innerLayer  — 세포 내부 GameObject (DNA 나선/바이러스/내부 HUD). cam1 이 ignore.
  //   cam2        — zoom=1, scroll(0,0) 보조 카메라. inside 진입 시 visible=true.
  //   hostCell    — 줌인 대상 호중구. inside 진행 중 reference 보존, 복귀 시 null.
  //   innerTime   — 내부 가상 시간 (초). 매 inside 진입 시 0 으로 리셋 (단순화).
  //   dnaGfx      — 중앙 DNA 나선 placeholder. 첫 진입 시 lazy 생성, 이후 재사용.
  //   viruses     — 클릭으로 spawn 된 placeholder 바이러스들 (직진).
  private outerLayer!: Phaser.GameObjects.Layer;
  private innerLayer!: Phaser.GameObjects.Layer;
  private cam2!: Phaser.Cameras.Scene2D.Camera;
  private hostCell: import('../entities/WhiteCell').WhiteCell | null = null;
  private innerTime = 0;
  private dnaGfx: Phaser.GameObjects.Graphics | null = null;
  private viruses: Array<{ x: number; y: number; vx: number; vy: number; gfx: Phaser.GameObjects.Graphics }> = [];
  // 진단: updateInside 첫 호출 1회만 로그 (매 프레임 floods 방지).
  private updateInsideLogged = false;
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
    // 게임: 세포 내부 phase 상태도 매 create() 마다 초기화. restart 시 stale ref 회피.
    this.hostCell = null;
    this.innerTime = 0;
    this.dnaGfx = null;
    this.viruses = [];
    this.updateInsideLogged = false;
    const W = this.scale.width;
    const H = this.scale.height;

    // 게임: outer/inner Layer 분리 + 보조 카메라 cam2.
    //   ADDED_TO_SCENE 리스너로 이후 생성되는 모든 GameObject 가 outerLayer 로 자동 라우팅.
    //   inner 컨텐츠는 명시적으로 innerLayer.add(...) 로 reparent 해야 함.
    //   cam1 (default) ignores innerLayer → outer 에서 inner 안 보임.
    //   cam2 ignores outerLayer + zoom=1 + visible=false → inside 진입 시만 켜짐.
    this.outerLayer = this.add.layer();
    this.innerLayer = this.add.layer();
    // restart 시 listener 중복 방지.
    this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.routeAddedToOuter, this);
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.routeAddedToOuter, this);
    this.cam2 = this.cameras.add(0, 0, W, H);
    this.cam2.setZoom(1);
    this.cam2.setScroll(0, 0);
    this.cam2.setVisible(false);
    this.cameras.main.ignore(this.innerLayer);
    this.cam2.ignore(this.outerLayer);
    // 진단: 카메라 id 확인. cameraFilter 비트마스크 검증용.
    console.log('[setup] cam1.id =', this.cameras.main.id, ' cam2.id =', this.cam2.id);
    console.log('[setup] cam1.visible =', this.cameras.main.visible, ' cam2.visible =', this.cam2.visible);

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

    // 게임: 호중구 무작위 배치. M3.3 검수용으로 hp 60~100% 랜덤 → 시작부터 다양한 크기.
    for (let i = 0; i < NEUTROPHIL_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      const hp = NEUTROPHIL.combat.maxHp * (0.6 + Math.random() * 0.4);
      this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, phase, hp));
    }

    // 게임: 세균 무작위 배치. 동일하게 hp 60~100% 랜덤.
    for (let i = 0; i < BACTERIA_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      const hp = BACTERIA_A.combat.maxHp * (0.6 + Math.random() * 0.4);
      this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase, hp);
    }

    // 게임: 대식세포 배치 (M5.4a). 화면 바닥에서 좌우만 이동.
    //   납작 비율 0.55 반영해 시각 외곽이 화면 바닥에 닿도록 (Macrophage.ts 의 setScale 과 동기).
    const floorY = H - MACROPHAGE.shape.base * 0.55;
    for (let i = 0; i < MACROPHAGE_COUNT; i++) {
      const x = 100 + Math.random() * (W - 200);
      const phase = Math.random() * Math.PI * 2;
      this.macrophageSystem.add(new Macrophage(MACROPHAGE, this.cellRenderer, x, floorY, phase));
    }

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
      if (this.phase === 'placing') {
        this.confirmPlacement(pointer.x, pointer.y);
        return;
      }
      // 게임: 세포 내부 — 클릭 방향의 wall 한 점에서 placeholder 바이러스 spawn.
      if (this.phase === 'inside') {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;
        const angle = Math.atan2(pointer.y - cy, pointer.x - cx);
        console.log('[pointerdown inside] click=', pointer.x, pointer.y, 'angle=', angle.toFixed(2));
        this.spawnVirus(angle);
        return;
      }
      // 게임: 줌 전환 중에는 클릭 무시 (충격파 발사 차단).
      if (this.phase !== 'running') return;
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
    this.add.text(20, 80, '[N]+호중구10  [B]+세균10  [P]일시정지  [R]리셋  [1/2/3] 1x/2x/4x', {
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
    // 게임: 화면 중앙 안내 텍스트 — placement 중에만 표시.
    this.placementText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 60, '', {
      color: '#fff',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '24px',
      align: 'center',
    });
    this.placementText.setOrigin(0.5, 0.5);

    // 게임: 텍스트 생성 후 첫 placement 시작 (안내 + 미리보기 핸들 표시).
    this.beginNextPlacement(W, H);

    // Phaser: 디버그 키. scene.restart() 시 자동 정리되고 create 에서 재등록.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-N', () => this.spawnNeutrophils(10));
      kb.on('keydown-B', () => this.spawnBacteria(10));
      kb.on('keydown-P', () => { this.paused = !this.paused; });
      kb.on('keydown-R', () => this.scene.restart());
      kb.on('keydown-ONE',   () => { this.speedMultiplier = 1; });
      kb.on('keydown-TWO',   () => { this.speedMultiplier = 2; });
      kb.on('keydown-THREE', () => { this.speedMultiplier = 4; });
      // 게임: [Z] — 화면 안 첫 호중구로 줌인 → 세포 내부 phase 진입.
      //        바이러스 침입 메커닉이 정해지면 이 트리거 자리에 그 이벤트가 들어감.
      kb.on('keydown-Z', () => this.zoomIntoNeutrophil());
      // 게임: [ESC] — 세포 내부에서 혈관 뷰로 복귀.
      kb.on('keydown-ESC', () => this.exitInside());
    }
  }

  // 게임: ADDED_TO_SCENE 리스너 — 새로 추가된 GameObject 를 outerLayer 로 라우팅 + cam2 ignore.
  //   Phaser 의 Camera.ignore(Layer) 는 호출 시점의 자식만 처리하고 이후 추가는 자동 적용 X.
  //   따라서 객체별 명시 ignore 가 필요. inner 컨텐츠는 routing 후 addToInner(...) 로 재이동.
  //   주의: Phaser Layer.add 가 ADDED_TO_SCENE 을 *재발화* 하므로 (Layer.js addChildCallback),
  //         이미 inner/outer Layer 에 들어있는 객체는 가드로 무시해야 무한 루프 방지.
  //         Phaser Layer 는 자식 추적을 displayList 속성으로 함 (parentContainer 가 아님).
  private routeAddedToOuter(gameObject: Phaser.GameObjects.GameObject): void {
    if (gameObject instanceof Phaser.GameObjects.Layer) return;
    const dl = (gameObject as { displayList?: unknown }).displayList;
    if (dl === this.innerLayer || dl === this.outerLayer) return;
    this.outerLayer.add(gameObject);
    this.cam2.ignore(gameObject);
  }

  // 게임: inner 컨텐츠 등록 헬퍼 — innerLayer 로 reparent + 카메라 필터 정정.
  //   생성 직후엔 ADDED_TO_SCENE 리스너가 outer 라우팅 + cam2.ignore 를 이미 적용했으므로,
  //   여기선 cam1 ignore 추가 + cam2 ignore 비트 해제 (둘 다 ignore 면 어디서도 안 보임).
  //   Phaser: GameObject.cameraFilter 는 ignore 카메라 id 비트마스크. AND ~id 로 해제.
  private addToInner(gameObject: Phaser.GameObjects.GameObject): void {
    const filtered = gameObject as Phaser.GameObjects.GameObject & { cameraFilter: number };
    const before = filtered.cameraFilter;
    this.innerLayer.add(gameObject);
    this.cameras.main.ignore(gameObject);
    filtered.cameraFilter &= ~this.cam2.id;
    console.log('[addToInner]', gameObject.constructor.name,
      'cameraFilter:', before, '→', filtered.cameraFilter,
      '(cam1.id=', this.cameras.main.id, 'cam2.id=', this.cam2.id, ')');
  }

  // 게임: 다음 placement 슬롯 — 큐 비면 phase='running' 으로 전환.
  //        미리보기 핸들 (반투명 alpha 0.6) 마우스 위치에 생성.
  private beginNextPlacement(W: number, H: number): void {
    if (this.placementQueue.length === 0) {
      this.phase = 'running';
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
    if (slot.dna === BACTERIA_COMMANDER) {
      this.bacteriaBehavior.spawn(slot.dna, x, y, phase);
    } else {
      // 게임: 호중구류 (TCELL/BCELL/NEUTROPHIL/...) 는 모두 WhiteCell 풀.
      this.whiteCellBehavior.add(new WhiteCell(slot.dna, this.cellRenderer, x, y, phase));
    }
    this.beginNextPlacement(this.scale.width, this.scale.height);
  }

  // 게임: 호중구 1마리 골라 그 위로 카메라 줌인 → 세포 내부 phase 진입.
  //   - 대상 없거나 phase != running 이면 noop
  //   - 동적 줌: cell base 가 화면 단축의 ZOOM_FILL_RATIO 차지하도록
  //   - 외부 sim 정지는 update() 의 phase 분기로 처리 (paused 플래그는 [P] 키 전용)
  private zoomIntoNeutrophil(): void {
    console.log('[zoomIntoNeutrophil] phase=', this.phase);
    if (this.phase !== 'running') return;
    const target = this.whiteCellBehavior.getAlive().find((c) => c.dna === NEUTROPHIL);
    if (!target) {
      console.log('[zoomIntoNeutrophil] no NEUTROPHIL target found');
      return;
    }

    this.hostCell = target;
    this.phase = 'zoomingIn';

    const W = this.scale.width;
    const H = this.scale.height;
    const ZOOM_FILL_RATIO = 0.60; // cell base 지름이 화면 단축의 60%
    const targetZoom = (Math.min(W, H) * ZOOM_FILL_RATIO) / (target.dna.shape.base * 2);

    const cam = this.cameras.main;
    const ZOOM_DURATION = 800;
    cam.pan(target.x, target.y, ZOOM_DURATION, Phaser.Math.Easing.Cubic.InOut);
    cam.zoomTo(targetZoom, ZOOM_DURATION, Phaser.Math.Easing.Cubic.InOut);
    console.log('[zoomIntoNeutrophil] tween started, target zoom=', targetZoom, 'host=', target.x, target.y);

    cam.once(Phaser.Cameras.Scene2D.Events.ZOOM_COMPLETE, () => {
      console.log('[ZOOM_COMPLETE] firing → enterInside');
      this.enterInside();
    });
  }

  // 게임: 줌인 완료 → 세포 내부 phase. innerTime 0 부터, cam2 visible, inner 컨텐츠 보장.
  private enterInside(): void {
    console.log('[enterInside] before: phase=', this.phase, 'cam2.visible=', this.cam2.visible);
    this.phase = 'inside';
    this.innerTime = 0;
    this.ensureInnerContent();
    this.cam2.setVisible(true);
    console.log('[enterInside] after: phase=', this.phase, 'cam2.visible=', this.cam2.visible,
      'innerLayer.length=', this.innerLayer.length);
  }

  // 게임: 세포 내부 컨텐츠 lazy 생성. 첫 진입 또는 restart 후 첫 진입에만 생성.
  //   - dnaGfx : 중앙 회전 DNA 나선 (placeholder)
  //   - innerHud : ESC/클릭 안내 텍스트
  //   생성 직후 innerLayer.add 로 reparent → cam2 가 그리고 cam1 은 무시.
  private ensureInnerContent(): void {
    console.log('[ensureInnerContent] dnaGfx=', this.dnaGfx);
    if (this.dnaGfx !== null) return;
    const W = this.scale.width;
    const H = this.scale.height;

    const dna = this.add.graphics();
    console.log('[ensureInnerContent] dna created, parent before addToInner=',
      (dna as { parentContainer?: unknown }).parentContainer);
    this.addToInner(dna);
    console.log('[ensureInnerContent] dna after addToInner: parent=',
      (dna as { parentContainer?: unknown }).parentContainer === this.innerLayer ? 'innerLayer' : 'OTHER',
      'cameraFilter=', (dna as unknown as { cameraFilter: number }).cameraFilter);
    this.dnaGfx = dna;

    const hud = this.add.text(W / 2, H - 30,
      '[ESC] 나가기   |   클릭 = 바이러스 spawn (placeholder)',
      {
        color: '#aaaaaa',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '14px',
      });
    hud.setOrigin(0.5, 0.5);
    this.addToInner(hud);
    console.log('[ensureInnerContent] innerLayer.length=', this.innerLayer.length);
  }

  // 게임: 세포 내부 → 혈관 뷰 복귀. ESC 트리거. inside phase 에서만 동작.
  //   cam2 끄고 viruses 정리 → 카메라 원위치 tween → running 복귀.
  private exitInside(): void {
    if (this.phase !== 'inside') return;
    this.phase = 'zoomingOut';
    this.cam2.setVisible(false);
    this.clearViruses();

    const cam = this.cameras.main;
    const ZOOM_DURATION = 800;
    cam.pan(this.scale.width / 2, this.scale.height / 2, ZOOM_DURATION, Phaser.Math.Easing.Cubic.InOut);
    cam.zoomTo(1, ZOOM_DURATION, Phaser.Math.Easing.Cubic.InOut);
    cam.once(Phaser.Cameras.Scene2D.Events.ZOOM_COMPLETE, () => {
      this.phase = 'running';
      this.hostCell = null;
    });
  }

  // 게임: 내부 phase 진행 (외부 sim 정지). innerTime 만 진행.
  //   1) DNA 나선 회전 그리기  2) viruses 위치 적분 + 중앙 도달 시 제거.
  private updateInside(delta: number): void {
    if (!this.updateInsideLogged) {
      console.log('[updateInside] FIRST CALL — phase=', this.phase,
        'cam2.visible=', this.cam2.visible,
        'innerLayer.length=', this.innerLayer.length,
        'dnaGfx=', !!this.dnaGfx);
      this.updateInsideLogged = true;
    }
    const dtReal = delta / 1000;
    const dt = dtReal * this.speedMultiplier;
    this.innerTime += dt;
    const t = this.innerTime;

    this.drawDnaHelix(t);
    this.updateViruses(dt);

    this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  speed: ${this.speedMultiplier}x  [INSIDE]`);
  }

  // 게임: DNA 나선 placeholder. 두 strand + base pair, t 에 따라 회전.
  private drawDnaHelix(t: number): void {
    if (!this.dnaGfx) return;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const LENGTH = 160;
    const RADIUS = 24;
    const TURNS = 2;
    const STEPS = 60;
    const SPIN = 1.5; // rad/s

    this.dnaGfx.clear();

    this.dnaGfx.lineStyle(2.5, 0x88ff99, 0.95);
    for (let strand = 0; strand < 2; strand++) {
      const phaseOffset = strand * Math.PI;
      for (let i = 0; i < STEPS; i++) {
        const u0 = i / STEPS;
        const u1 = (i + 1) / STEPS;
        const a0 = u0 * TURNS * Math.PI * 2 + t * SPIN + phaseOffset;
        const a1 = u1 * TURNS * Math.PI * 2 + t * SPIN + phaseOffset;
        const x0 = cx + Math.cos(a0) * RADIUS;
        const y0 = cy + (u0 - 0.5) * LENGTH;
        const x1 = cx + Math.cos(a1) * RADIUS;
        const y1 = cy + (u1 - 0.5) * LENGTH;
        this.dnaGfx.lineBetween(x0, y0, x1, y1);
      }
    }

    // 게임: base pair — 두 strand 사이 가로 짧은 선.
    this.dnaGfx.lineStyle(1.2, 0x336644, 0.7);
    const PAIRS = 10;
    for (let i = 0; i < PAIRS; i++) {
      const u = (i + 0.5) / PAIRS;
      const a = u * TURNS * Math.PI * 2 + t * SPIN;
      const x0 = cx + Math.cos(a) * RADIUS;
      const x1 = cx + Math.cos(a + Math.PI) * RADIUS;
      const y = cy + (u - 0.5) * LENGTH;
      this.dnaGfx.lineBetween(x0, y, x1, y);
    }
  }

  // 게임: 클릭 방향 wall 위치에서 바이러스 spawn → 중앙(DNA) 직진.
  //   wall 위치 = host DNA 의 evaluateRadius 결과를 cam1 zoom 으로 환산해 screen 좌표화.
  //   cam1 이 호스트 위치에 panned 되어있으므로 화면 중앙 = host 중심.
  private spawnVirus(angle: number): void {
    if (!this.hostCell) return;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const zoom = this.cameras.main.zoom;
    const rWorld = evaluateRadius(this.hostCell.dna, angle, this.innerTime);
    const sx = cx + Math.cos(angle) * rWorld * zoom;
    const sy = cy + Math.sin(angle) * rWorld * zoom;

    const SPEED = 60;
    const dx = cx - sx;
    const dy = cy - sy;
    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * SPEED;
    const vy = (dy / len) * SPEED;

    const gfx = this.add.graphics();
    gfx.fillStyle(0xff5577, 1);
    gfx.fillCircle(0, 0, 4);
    gfx.setPosition(sx, sy);
    this.addToInner(gfx);

    this.viruses.push({ x: sx, y: sy, vx, vy, gfx });
    console.log('[spawnVirus] angle=', angle.toFixed(2), 'pos=', sx.toFixed(0), sy.toFixed(0),
      'vel=', vx.toFixed(1), vy.toFixed(1), 'total viruses=', this.viruses.length);
  }

  // 게임: 바이러스 위치 적분 + DNA 도달 시 제거 (향후 데미지 처리 자리).
  private updateViruses(dt: number): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const HIT_RADIUS = 16;
    for (let i = this.viruses.length - 1; i >= 0; i--) {
      const v = this.viruses[i];
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      v.gfx.setPosition(v.x, v.y);
      const dx = cx - v.x;
      const dy = cy - v.y;
      if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
        v.gfx.destroy();
        this.viruses.splice(i, 1);
      }
    }
  }

  private clearViruses(): void {
    for (const v of this.viruses) v.gfx.destroy();
    this.viruses = [];
  }

  // 게임: 디버그용 호중구 스폰 — 무작위 위치, 100% hp.
  private spawnNeutrophils(count: number): void {
    const W = this.scale.width;
    const H = this.scale.height;
    for (let i = 0; i < count; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      this.whiteCellBehavior.add(new WhiteCell(NEUTROPHIL, this.cellRenderer, x, y, phase));
    }
  }

  private spawnBacteria(count: number): void {
    const W = this.scale.width;
    const H = this.scale.height;
    for (let i = 0; i < count; i++) {
      const x = 100 + Math.random() * (W - 200);
      const y = 100 + Math.random() * (H - 200);
      const phase = Math.random() * Math.PI * 2;
      this.bacteriaBehavior.spawn(BACTERIA_A, x, y, phase);
    }
  }

  // Phaser: 매 프레임 호출. delta 는 ms.
  override update(_time: number, delta: number): void {
    // 진단: 항상 보이는 HUD — phase + cam2 + inner 상태.
    if (this.debugHud) {
      this.debugHud.setText(
        `phase=${this.phase}  cam2.visible=${this.cam2?.visible}  inner.len=${this.innerLayer?.length}  viruses=${this.viruses.length}  dnaGfx=${!!this.dnaGfx}`,
      );
    }

    // 게임: 일시정지 — update 자체를 skip. gameTime 정지 → 모든 시각/물리 멈춤.
    if (this.paused) {
      this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  speed: ${this.speedMultiplier}x  [PAUSED]`);
      return;
    }

    // 게임: 줌 전환 중에는 외부/내부 sim 모두 정지 (카메라 tween 만 진행).
    if (this.phase === 'zoomingIn' || this.phase === 'zoomingOut') {
      this.fpsText.setText(`FPS: ${this.game.loop.actualFps.toFixed(1)}  [${this.phase}]`);
      return;
    }

    // 게임: 세포 내부 phase — 외부 sim 정지, 내부 sim 만 진행.
    if (this.phase === 'inside') {
      this.updateInside(delta);
      return;
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
    const macrophageFloorY = bounds.height - MACROPHAGE.shape.base * 0.55;
    this.macrophageSystem.update(macrophageFloorY, dt, allCells, allBacteria);

    // 게임: 7b) 항체 시스템 — 위치 적분 + 사거리 만료 시 정지.
    //         WhiteCellBehaviorSystem 의 processBCellFiring 에서 spawn 됨.
    this.antibodySystem.update(dt);

    // 게임: 8) 점수 100 도달 시 호중구 생산. 대식세포 위에서 등장.
    //         호중구 사체 점수 ≥40 이면 슈퍼 호중구.
    this.tryProduceWhiteCell();

    // 게임: 9) 흡수된 시체 정리 — 풀에서 제거 + 그래픽 핸들 destroy.
    this.cleanupAbsorbed();

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
  //   후보가 없으면 record 는 이미 소비됐으므로 다음 사망 시까지 진화 없음.
  private evolveCommanders(t: number): void {
    const expired = this.teamSystem.consumeExpiredDeathRecords(t, COMMANDER_EVOLUTION_DELAY);
    if (expired.length === 0) return;
    for (const _deathTime of expired) {
      const candidates = this.bacteriaBehavior
        .getAlive()
        .filter((b) => !b.isCommander());
      if (candidates.length === 0) continue;
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
  //   - 슈퍼/NK/BCELL/TCELL 등은 진화 X (`dna === NEUTROPHIL` 체크)
  private evolveNeutrophils(): void {
    const candidates = this.whiteCellBehavior
      .getAlive()
      .filter((c) => c.dna === NEUTROPHIL && c.level >= NEUTROPHIL_EVOLUTION_LEVEL);
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
