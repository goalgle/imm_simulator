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
  // 가장 가까운 동족이 너무 가까울 때 멀어짐. comfortRadius 안에 있을 때만 활성.
  spaceAlly: { weight: number; comfortRadius: number };
  // 가장 가까운 동족으로 향함 (군집형). 항상 활성.
  seekAlly: { weight: number };
};

// 게임: 세포 1개의 정본 DNA.
//   shape    : r(θ, t) 함수의 파라미터
//   color    : HSL (h 0~360, s/l 0~100). 활성화 보간을 위해 RGB 가 아닌 HSL 채택.
//   behavior : target 1=적, 0=무관심, -1=아군 / speed 이동 px/s / contact 접촉 시 간섭 강도
//              turnRate 1/sec — 클수록 desired velocity 로 빠르게 수렴 (관성 ↔ 즉시 전환)
//   drives   : 행동 동기 가중치 (위 Drives 정의)
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
  };
  drives: Drives;
  meta: {
    recovery: number;
    divide: number;
  };
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
  behavior: { target: 1.0, speed: 15, contact: 0.35, turnRate: 1.5 },
  drives: {
    avoidPredator: { weight: 0, triggerRadius: 0 },
    seekNutrient:  { weight: 0 },
    seekPrey:      { weight: 1.0 },
    spaceAlly:     { weight: 0, comfortRadius: 0 },
    seekAlly:      { weight: 0 },
  },
  meta: { recovery: 0.6, divide: 0.0 },
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
  behavior: { target: 0, speed: 30, contact: 0, turnRate: 3.0 },
  drives: {
    avoidPredator: { weight: 1.0, triggerRadius: 180 },
    seekNutrient:  { weight: 0.6 },
    seekPrey:      { weight: 0 },
    spaceAlly:     { weight: 0.3, comfortRadius: 50 },
    seekAlly:      { weight: 0 },
  },
  meta: { recovery: 0.3, divide: 0 },
};
