// DNA 정본(canonical) 스키마.
// 시스템 구현 기획서 §3 — 본 게임은 이 객체를 정본으로 사용.
// UI 코드(#A34C-...) 와 미니게임 segments 는 이 정본의 파생일 뿐 (M3+ 에서 정의).
//
// 모든 형질은 숫자 (또는 숫자만 담은 객체) — 바이러스 변이가 산술 연산으로 일관 처리되도록.
// 이 파일은 Phaser 의존 없음 (도메인 계층).

// 게임: 단일 wave 의 형태 파라미터.
//   A     : amplitude — 변형의 크기 (base 대비 비율)
//   n     : angular frequency — 한 바퀴(2π)에 들어가는 돌기 수
//   omega : time frequency — 시간에 따른 변형 속도
export type Wave = {
  A: number;
  n: number;
  omega: number;
};

// 게임: 지휘(command) 형질. 모든 종이 동일 구조 보유, 일반 종은 무영향(0) 값.
//   baseTeamSize=0 인 엔티티는 "지휘관 아님" 으로 판정. >=1 이면 지휘관.
//   영양분 흡수 시 시야/지휘범위 ↑ + 레벨업 (분열 X — 별도 분기).
//   max team size = baseTeamSize + floor(level / teamSizeStep).
export type Command = {
  visionRange: number;        // 시야 (호중구 인식 거리)
  commandRange: number;       // 지휘 범위 (멤버 영입/유지 거리)
  visionGrowth: number;       // 흡수 1회당 시야 +
  commandGrowth: number;      // 흡수 1회당 지휘범위 +
  baseTeamSize: number;       // 0 = 지휘관 아님
  teamSizeStep: number;       // 몇 레벨마다 팀원 +1 (예: 3)
  levelUpAbsorbCount: number; // 영양분 몇 개 흡수 = 1 레벨업
};

// 게임: 행동 동기(drive) 의 표준 집합.
// 모든 종(백혈구/세균) 이 동일 구조를 가지며, weight=0 이면 비활성과 동일.
// 새 drive 가 추가되면 모든 프리셋에 0 으로 반영하면 됨.
export type Drives = {
  // 가장 가까운 포식자(다른 종족)에서 멀어지는 방향. triggerRadius 안에 있을 때만 활성.
  avoidPredator: { weight: number; triggerRadius: number };
  // 가장 가까운 영양분으로 향함. 영양분이 있으면 항상 활성. (세균이 사용)
  seekNutrient: { weight: number };
  // 가장 가까운 먹이(다른 종족)로 향함. (백혈구가 세균을 추적할 때 사용)
  seekPrey: { weight: number };
  // 가장 가까운 적 진영 커맨더로 향함. NK 가 우선 추적할 때 사용.
  seekCommander: { weight: number };
  // 가장 가까운 일반 세균(워커)에서 멀어지는 방향. NK 가 우회할 때 사용.
  avoidWorker: { weight: number; triggerRadius: number };
  // 가장 가까운 동족이 너무 가까울 때 멀어짐. comfortRadius 안에 있을 때만 활성.
  spaceAlly: { weight: number; comfortRadius: number };
  // 가장 가까운 동족으로 향함 (군집형). 항상 활성.
  seekAlly: { weight: number };
  // 자기 팀 지휘관 쪽으로. 지휘범위 안에서는 활성도 0 (자유), 밖에서 끌림.
  followCommander: { weight: number };
};

// 게임: 세포 1개의 정본 DNA.
//   shape    : r(θ, t) 함수의 파라미터
//   color    : HSL (h 0~360, s/l 0~100). 활성화 보간을 위해 RGB 가 아닌 HSL 채택.
//   behavior : target 1=적, 0=무관심, -1=아군 / speed 이동 px/s / contact 접촉 시 간섭 강도
//              turnRate 1/sec — 클수록 desired velocity 로 빠르게 수렴 (관성 ↔ 즉시 전환)
//   drives   : 행동 동기 가중치 (위 Drives 정의)
//   combat   : maxHp 최대 체력 / attack 단위 시간당 가하는 데미지 (M3.4 전투에서 사용)
//              currentHp 는 엔티티 상태이지 DNA 가 아님 — DNA 는 종족 형질만.
//   meta     : recovery 회복 속도 / divide 분열 확률
export type DNA = {
  shape: {
    base: number;
    w1: Wave;
    w2: Wave;
    w3: Wave;
  };
  color: {
    h: number;
    s: number;
    l: number;
  };
  behavior: {
    target: number;
    speed: number;
    contact: number;
    turnRate: number;
    // 게임: HP 가 줄어도 속도가 일정 수준 이하로 떨어지지 않도록 하는 캡 (0~1).
    //       0 = HP 비례 (호중구 등 일반), 1 = HP 무관 (NK 등 암살자).
    //       effectiveRatio = max(hpRatio, minSpeedRatio).
    minSpeedRatio: number;
  };
  drives: Drives;
  combat: {
    maxHp: number;
    attack: number;
  };
  command: Command;
  // 게임: M7 — 발사체(항체 등) 형질. 발사 안 하는 종은 모두 0.
  armament: Armament;
  meta: {
    recovery: number;
    divide: number;
  };
};

// 게임: 무장 형질. B세포가 항체를 발사할 때 사용. 다른 종은 모두 0.
//   fireRange         : 표적 인식 거리 (시야)
//   fireCooldown      : 발사 주기 (초)
//   projectileSpeed   : 발사체 속도 (px/s)
//   projectileDamage  : 발사체 데미지 (세균이 흡수 시 hp 감소량)
//   projectileRange   : 발사체 사거리 (px). 이 거리 지나면 정지 (지뢰 모드)
export type Armament = {
  fireRange: number;
  fireCooldown: number;
  projectileSpeed: number;
  projectileDamage: number;
  projectileRange: number;
};

// 게임: 호중구(Neutrophil) 프리셋.
// 아이디어 기획서 §백혈구 종류별 파라미터 #1 호중구.
// base 값은 화면에서 시각 확인 가능한 크기(32px)로 스케일.
// 색상 #E8B4D4 → HSL(322, 53%, 81%) 근사.
// M3.1 부터 자체 추진 활성: speed=15(세균의 절반), turnRate=1.5 (세균보다 둔함),
//   seekPrey weight=1.0 으로 가장 가까운 세균을 추적.
//   충격파에 의한 가속과 자체 추진이 가산되어 "관전형 + 결정적 개입" 균형.
export const NEUTROPHIL: DNA = {
  shape: {
    base: 32,
    w1: { A: 0.30, n: 4, omega: 2.5 },
    w2: { A: 0.20, n: 6, omega: 3.0 },
    w3: { A: 0.10, n: 8, omega: 3.5 },
  },
  color: { h: 322, s: 53, l: 81 },
  behavior: { target: 1.0, speed: 15, contact: 0.35, turnRate: 1.5, minSpeedRatio: 0 },
  drives: {
    avoidPredator:   { weight: 0, triggerRadius: 0 },
    seekNutrient:    { weight: 0 },
    seekPrey:        { weight: 1.0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0, comfortRadius: 0 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 100, attack: 20 },
  command: {
    visionRange: 0,
    commandRange: 0,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0.6, divide: 0.0 },
};

// 게임: NK 세포 (Natural Killer) 프리셋. M7 — 대식세포가 1/10 확률로 생산.
//   특징:
//     - 작은 체구 (base 22) — 일반 호중구(32)보다 작음
//     - 강한 공격력 (attack 35), 빠름 (speed 30, turnRate 3.0)
//     - HP 가 줄어도 속도 유지 (minSpeedRatio 1.0)
//     - 커맨더 우선 추적 (seekCommander 1.5), 일반 세균은 회피하며 우회 (avoidWorker 0.4/80)
//     - 커맨더 없으면 일반 세균 fallback (seekPrey 0.7)
//   색상: 진한 청보라 — 슈퍼 호중구(분홍 보라) 와 명확히 구분.
export const NK_CELL: DNA = {
  shape: {
    base: 22,
    w1: { A: 0.35, n: 5, omega: 4.0 },
    w2: { A: 0.25, n: 7, omega: 5.0 },
    w3: { A: 0.15, n: 9, omega: 6.0 },
  },
  color: { h: 260, s: 55, l: 45 },
  behavior: { target: 1.0, speed: 30, contact: 0.4, turnRate: 3.0, minSpeedRatio: 1.0 },
  drives: {
    avoidPredator:   { weight: 0, triggerRadius: 0 },
    seekNutrient:    { weight: 0 },
    seekPrey:        { weight: 0.7 },
    seekCommander:   { weight: 1.5 },
    avoidWorker:     { weight: 0.4, triggerRadius: 80 },
    spaceAlly:       { weight: 0, comfortRadius: 0 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 80, attack: 35 },
  command: {
    visionRange: 0,
    commandRange: 0,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0.8, divide: 0 },
};

// 게임: B 세포 (B-cell) 프리셋. M7 — 미사일 기지형 백혈구.
//   특징:
//     - 작은 체구 (base 20), 매우 낮은 HP (50), 거의 정지 (speed 5)
//     - 직접 공격 X — armament 로 항체 발사
//     - 항체는 영양분처럼 보여 세균이 흡수 → HP 감소 (지뢰형 발사체)
//     - 항체는 사거리 만료 시 정지 후 그 자리에 남음
//   색상: 연보라 (아이디어 기획서 §B세포).
export const BCELL: DNA = {
  shape: {
    base: 20,
    w1: { A: 0.20, n: 2, omega: 1.0 },
    w2: { A: 0.15, n: 3, omega: 1.5 },
    w3: { A: 0.10, n: 4, omega: 2.0 },
  },
  color: { h: 232, s: 50, l: 70 },
  behavior: { target: 1.0, speed: 5, contact: 0.2, turnRate: 1.0, minSpeedRatio: 0 },
  drives: {
    avoidPredator:   { weight: 0, triggerRadius: 0 },
    seekNutrient:    { weight: 0 },
    seekPrey:        { weight: 0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0, comfortRadius: 0 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 50, attack: 0 },
  command: {
    visionRange: 0,
    commandRange: 0,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: {
    fireRange: 250,
    fireCooldown: 3.0,
    projectileSpeed: 40,
    projectileDamage: 15,
    projectileRange: 250,
  },
  meta: { recovery: 0.4, divide: 0 },
};

// 게임: T 세포 (T-cell, 대장세포) 프리셋. M7 — 백혈구 진영의 지휘관.
//   특징:
//     - 직접 공격 X (attack 0)
//     - 호중구들 근처에 머무름 (seekAlly 1.0)
//     - 시야 넓음 (command.visionRange 450) — 미래 명령 메커니즘용 보존
//     - 지휘범위(command.commandRange 200) 안에서 호중구가 세균 죽이면 그 호중구 레벨업
//     - 호중구 5레벨 도달 시 NK/BCELL/SUPER 중 무작위 진화 (T세포 자체는 진화 X)
//     - baseTeamSize=0 (세균 커맨더와 다름 — isCommander 헬퍼는 false)
//   색상: 진한 청록 (아이디어 기획서 §T세포).
export const TCELL: DNA = {
  shape: {
    base: 24,
    w1: { A: 0.25, n: 3, omega: 3.5 },
    w2: { A: 0.15, n: 5, omega: 4.0 },
    w3: { A: 0.10, n: 7, omega: 4.5 },
  },
  color: { h: 186, s: 50, l: 40 },
  behavior: { target: 0, speed: 25, contact: 0.3, turnRate: 3.0, minSpeedRatio: 0 },
  drives: {
    avoidPredator:   { weight: 0, triggerRadius: 0 },
    seekNutrient:    { weight: 0 },
    seekPrey:        { weight: 0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0.2, comfortRadius: 50 },
    seekAlly:        { weight: 1.0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 100, attack: 0 },
  command: {
    visionRange: 450,
    commandRange: 200,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0.6, divide: 0 },
};

// 게임: 슈퍼 호중구 프리셋. M5.4c — 대식세포가 호중구 사체 점수 ≥ 40 모았을 때 생산.
//   - 일반 호중구의 강화판: 더 크고 빠르고 강함
//   - 색조 확연히 다름 (진한 보라) — 시각적 식별 우선
//   - drives 는 일반과 동일 (seekPrey 추적)
export const NEUTROPHIL_SUPER: DNA = {
  shape: {
    base: 40,
    w1: { A: 0.30, n: 4, omega: 2.5 },
    w2: { A: 0.20, n: 6, omega: 3.0 },
    w3: { A: 0.10, n: 8, omega: 3.5 },
  },
  color: { h: 280, s: 65, l: 55 },
  behavior: { target: 1.0, speed: 32, contact: 0.4, turnRate: 2.0, minSpeedRatio: 0 },
  drives: {
    avoidPredator:   { weight: 0, triggerRadius: 0 },
    seekNutrient:    { weight: 0 },
    seekPrey:        { weight: 1.0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0, comfortRadius: 0 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 180, attack: 30 },
  command: {
    visionRange: 0,
    commandRange: 0,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0.7, divide: 0.0 },
};

// 게임: 세균 종 A 프리셋. 시스템 구현 기획서 §2.4.
//   성격 우선순위: 1) 백혈구 회피  2) 영양분 추구  3) 동족과 거리 두기
//   - base 18 (호중구 32 보다 작음)
//   - 어두운 회색 (l=30)
//   - 떨림 약하지만 더 불규칙 (n=5,7,9)
//   - speed 30 px/s, turnRate 3.0 (방향 전환 약 0.33초)
//   - drives: avoidPredator 가 weight 1.0 으로 dominant, seekNutrient 0.6, spaceAlly 0.3
export const BACTERIA_A: DNA = {
  shape: {
    base: 18,
    w1: { A: 0.20, n: 5, omega: 1.5 },
    w2: { A: 0.15, n: 7, omega: 2.0 },
    w3: { A: 0.10, n: 9, omega: 2.5 },
  },
  color: { h: 0, s: 0, l: 30 },
  behavior: { target: 0, speed: 30, contact: 0, turnRate: 3.0, minSpeedRatio: 0 },
  drives: {
    avoidPredator:   { weight: 1.0, triggerRadius: 180 },
    seekNutrient:    { weight: 0.6 },
    seekPrey:        { weight: 0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0.3, comfortRadius: 50 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0.7 },  // M5.2: 팀에 속하면 지휘범위 밖에서 끌림
  },
  combat: { maxHp: 60, attack: 15 },
  command: {
    visionRange: 180,           // 일반 세균 시야 (호중구 인식 거리). avoidPredator.triggerRadius 와 동일.
    commandRange: 0,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,            // 지휘관 아님
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0.3, divide: 0 },
};

// 게임: 세균 종 B (커맨더) 프리셋. 시스템 구현 기획서 §2.4 + M5 지휘관 메커닉.
//   - 일반 세균보다 큼 (base 28 vs 18, 호중구 32) → 시각 즉시 식별
//   - 짙은 자주 (회색 일반과 명확히 구분)
//   - 시야 540 = 일반 ×3, 영양분 흡수 시 시야/지휘범위 ↑
//   - 분열 X (대신 영양분 → 레벨업 → 팀원 증가)
//   - HP/공격력 일반보다 강함
export const BACTERIA_COMMANDER: DNA = {
  shape: {
    base: 28,
    w1: { A: 0.18, n: 5, omega: 1.2 },
    w2: { A: 0.12, n: 7, omega: 1.6 },
    w3: { A: 0.08, n: 9, omega: 2.0 },
  },
  color: { h: 330, s: 50, l: 25 },
  behavior: { target: 0, speed: 25, contact: 0, turnRate: 2.5, minSpeedRatio: 0 },
  drives: {
    // 회피 시야는 일반 세균과 동일(180) — 가까이 와야 도망. 그 안에 들어오면 강하게 회피(1.5).
    // 공격 결정 시야는 별도 (command.visionRange = 540) — 멀리서 호중구 인지하여 팀 모드 결정.
    // 두 시야가 분리되어 있어, 시야는 넓되 평소 영양분 추구를 방해하지 않음.
    avoidPredator:   { weight: 1.5, triggerRadius: 180 },
    seekNutrient:    { weight: 0.7 },
    seekPrey:        { weight: 0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0.2, comfortRadius: 60 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 120, attack: 25 },
  command: {
    visionRange: 540,
    commandRange: 120,
    visionGrowth: 15,
    commandGrowth: 8,
    baseTeamSize: 3,
    teamSizeStep: 3,
    levelUpAbsorbCount: 5,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0.4, divide: 0 },
};

// 게임: 대식세포 (Macrophage) 프리셋. 시스템 구현 기획서 §M5.4.
//   - 더 큰 크기 (base 40)
//   - 초록 (아이디어 기획서 §대식세포)
//   - 시체만 인터렉션, 호중구/세균/충격파 영향 X
//   - 화면 바닥에서 좌우로만 이동 (Y 고정)
//   - 자체 추진 속도는 MacrophageSystem 내부 상수로
//   - drives 모두 0 (별도 시스템이 행동 제어)
export const MACROPHAGE: DNA = {
  // 게임: 작고 납작 — base 25 + Macrophage.update 가 setScale(1.0, 0.55) 로 Y 압축.
  //        외곽이 더 불규칙 (A 큼 + n 다양) → 둥근 공보다 "기어다니는" 모호한 형태.
  shape: {
    base: 25,
    w1: { A: 0.25, n: 3, omega: 0.5 },
    w2: { A: 0.18, n: 5, omega: 0.8 },
    w3: { A: 0.10, n: 8, omega: 1.0 },
  },
  color: { h: 120, s: 30, l: 50 },
  behavior: { target: 0, speed: 40, contact: 0, turnRate: 0, minSpeedRatio: 0 },
  drives: {
    avoidPredator:   { weight: 0, triggerRadius: 0 },
    seekNutrient:    { weight: 0 },
    seekPrey:        { weight: 0 },
    seekCommander:   { weight: 0 },
    avoidWorker:     { weight: 0, triggerRadius: 0 },
    spaceAlly:       { weight: 0, comfortRadius: 0 },
    seekAlly:        { weight: 0 },
    followCommander: { weight: 0 },
  },
  combat: { maxHp: 200, attack: 0 },
  command: {
    visionRange: 0,
    commandRange: 0,
    visionGrowth: 0,
    commandGrowth: 0,
    baseTeamSize: 0,
    teamSizeStep: 0,
    levelUpAbsorbCount: 0,
  },
  armament: { fireRange: 0, fireCooldown: 0, projectileSpeed: 0, projectileDamage: 0, projectileRange: 0 },
  meta: { recovery: 0, divide: 0 },
};
