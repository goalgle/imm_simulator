// 행동 동기(drives) 평가 — 시스템 구현 기획서 §2.4.2 (M2.2 부드러운 우선순위).
//
// 각 drive 는 (단위 방향 벡터, 활성도 0~1) 을 반환.
// computeDesiredDirection 이 모든 drive 의 가중 합 후 정규화 → 최종 단위 방향.
//
// 우선순위는 별도 데이터가 아니라 weight 의 크기로 자연스럽게 표현됨.
//   1순위 = 큰 weight, 3순위 = 작은 weight.
//
// 모든 형질이 숫자라 바이러스 변이가 산술 연산으로 가능 (weight ×= 1.3 등).
//
// 이 파일은 Phaser 의존 없음 (단위 테스트 가능).

import type { Drives } from './dna';

// 게임: 위치만 가지면 되는 최소 인터페이스. WhiteCell, Bacteria, Nutrient 모두 적용 가능.
export type Positioned = {
  readonly x: number;
  readonly y: number;
};

// 게임: drive 1개 평가 결과. dirX/dirY 는 단위 벡터 (또는 영벡터).
//        activation 0 = 비활성, 1 = 최대.
export type DriveEval = {
  dirX: number;
  dirY: number;
  activation: number;
};

// 게임: 한 엔티티의 "감각 입력". 자기를 둘러싼 환경 정보 묶음.
//        BacteriaBehaviorSystem / WhiteCellBehaviorSystem 이 종족별로 다르게 채워서 전달.
export type Senses = {
  predators: readonly Positioned[];   // 회피 대상 (세균 → 백혈구, 백혈구 → 없음)
  allies: readonly Positioned[];       // 동족 (자기 자신 포함 가능)
  nearestNutrient: Positioned | null;  // 영양분 (세균이 사용)
  nearestPrey: Positioned | null;      // 먹이 (백혈구가 사용 — 세균)
  // 게임: 가장 가까운 살아있는 커맨더 종 — NK 의 seekCommander 평가용.
  nearestCommander: Positioned | null;
  // 게임: 가장 가까운 살아있는 일반 세균 — NK 의 avoidWorker 평가용.
  nearestWorker: Positioned | null;
  // 게임: 자기가 속한 팀의 지휘관. 무소속이면 null.
  //        controlRadius 는 지휘관의 currentCommandRange — 영양분 흡수로 늘어나는 동적 값.
  //        followCommander drive 가 이 거리 이내일 때 활성도 0 (자유 행동), 밖이면 끌어당김.
  commander: { x: number; y: number; controlRadius: number } | null;
};

const ZERO: DriveEval = { dirX: 0, dirY: 0, activation: 0 };

// 게임: 가장 가까운 후보까지의 (거리, dx, dy). 후보 없으면 null.
function nearest(
  selfX: number,
  selfY: number,
  candidates: readonly Positioned[],
  excludeSelf?: Positioned,
): { dist: number; dx: number; dy: number } | null {
  let best: { dist: number; dx: number; dy: number } | null = null;
  let bestDist2 = Infinity;
  for (const c of candidates) {
    if (excludeSelf !== undefined && c === excludeSelf) continue;
    const dx = c.x - selfX;
    const dy = c.y - selfY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = { dist: Math.sqrt(d2), dx, dy };
    }
  }
  return best;
}

// 게임: avoidPredator — 가장 가까운 포식자에서 멀어지는 방향.
//        triggerRadius 안에 있을 때만 활성, 가까울수록 활성도 ↑ (선형).
export function evalAvoidPredator(
  selfX: number,
  selfY: number,
  predators: readonly Positioned[],
  triggerRadius: number,
): DriveEval {
  const n = nearest(selfX, selfY, predators);
  if (n === null) return ZERO;
  if (n.dist > triggerRadius) return ZERO;
  if (n.dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  // 게임: 멀어지는 방향 = self - predator = -dx
  return {
    dirX: -n.dx / n.dist,
    dirY: -n.dy / n.dist,
    activation: 1 - n.dist / triggerRadius,
  };
}

// 게임: seekNutrient — 가장 가까운 영양분 방향. 있으면 활성도 1.
export function evalSeekNutrient(
  selfX: number,
  selfY: number,
  nutrient: Positioned | null,
): DriveEval {
  if (nutrient === null) return ZERO;
  const dx = nutrient.x - selfX;
  const dy = nutrient.y - selfY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  return { dirX: dx / dist, dirY: dy / dist, activation: 1 };
}

// 게임: seekPrey — 가장 가까운 먹이(다른 종족) 방향. 있으면 활성도 1.
//        백혈구가 세균을 추적할 때 사용. 세균은 weight=0 이라 무영향.
export function evalSeekPrey(
  selfX: number,
  selfY: number,
  prey: Positioned | null,
): DriveEval {
  if (prey === null) return ZERO;
  const dx = prey.x - selfX;
  const dy = prey.y - selfY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  return { dirX: dx / dist, dirY: dy / dist, activation: 1 };
}

// 게임: seekCommander — 가장 가까운 적 진영 커맨더 방향. NK 가 우선 추적할 때 사용.
//        seekPrey 와 같은 로직이지만 대상이 커맨더만.
export function evalSeekCommander(
  selfX: number,
  selfY: number,
  commander: Positioned | null,
): DriveEval {
  if (commander === null) return ZERO;
  const dx = commander.x - selfX;
  const dy = commander.y - selfY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  return { dirX: dx / dist, dirY: dy / dist, activation: 1 };
}

// 게임: avoidWorker — 가장 가까운 일반 세균에서 멀어지는 방향. NK 가 우회할 때 사용.
//        avoidPredator 와 같은 패턴이지만 대상이 일반 세균.
export function evalAvoidWorker(
  selfX: number,
  selfY: number,
  worker: Positioned | null,
  triggerRadius: number,
): DriveEval {
  if (worker === null) return ZERO;
  const dx = worker.x - selfX;
  const dy = worker.y - selfY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > triggerRadius) return ZERO;
  if (dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  return {
    dirX: -dx / dist,
    dirY: -dy / dist,
    activation: 1 - dist / triggerRadius,
  };
}

// 게임: spaceAlly — 가장 가까운 동족이 comfortRadius 안에 있으면 멀어지는 방향.
//        가까울수록 활성도 ↑.
export function evalSpaceAlly(
  selfX: number,
  selfY: number,
  allies: readonly Positioned[],
  self: Positioned,
  comfortRadius: number,
): DriveEval {
  const n = nearest(selfX, selfY, allies, self);
  if (n === null) return ZERO;
  if (n.dist > comfortRadius) return ZERO;
  if (n.dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  return {
    dirX: -n.dx / n.dist,
    dirY: -n.dy / n.dist,
    activation: 1 - n.dist / comfortRadius,
  };
}

// 게임: followCommander — 지휘관이 controlRadius 안에 있으면 자유(활성도 0),
//        그 밖이면 지휘관 쪽으로 끌림. 거리가 멀수록 활성도 ↑.
//        (dist - controlRadius) / controlRadius — 1 배 거리에서 활성도 1.
export function evalFollowCommander(
  selfX: number,
  selfY: number,
  commander: { x: number; y: number; controlRadius: number } | null,
): DriveEval {
  if (commander === null) return ZERO;
  const dx = commander.x - selfX;
  const dy = commander.y - selfY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return ZERO;
  if (dist <= commander.controlRadius) return ZERO;
  if (commander.controlRadius <= 0) {
    // 게임: 잘못된 입력 방어. controlRadius 가 0 이면 무조건 끌림.
    return { dirX: dx / dist, dirY: dy / dist, activation: 1 };
  }
  const overflow = (dist - commander.controlRadius) / commander.controlRadius;
  const activation = overflow > 1 ? 1 : overflow;
  return { dirX: dx / dist, dirY: dy / dist, activation };
}

// 게임: seekAlly — 가장 가까운 동족 방향. 있으면 활성도 1.
export function evalSeekAlly(
  selfX: number,
  selfY: number,
  allies: readonly Positioned[],
  self: Positioned,
): DriveEval {
  const n = nearest(selfX, selfY, allies, self);
  if (n === null) return ZERO;
  if (n.dist < 0.001) return { dirX: 0, dirY: 0, activation: 1 };
  return { dirX: n.dx / n.dist, dirY: n.dy / n.dist, activation: 1 };
}

// 게임: 모든 drive 의 가중 합 → 정규화된 목표 방향.
//        weight=0 인 drive 는 자연스럽게 무시됨 (값 0 곱).
//        활성도 0 인 drive 도 무시됨.
//        결과 벡터 크기가 0 에 가까우면 (모든 drive 무활성) 정지 의도 (영벡터).
export function computeDesiredDirection(
  self: Positioned,
  drives: Drives,
  senses: Senses,
): { dirX: number; dirY: number } {
  const ap = evalAvoidPredator(self.x, self.y, senses.predators, drives.avoidPredator.triggerRadius);
  const sn = evalSeekNutrient(self.x, self.y, senses.nearestNutrient);
  const sprey = evalSeekPrey(self.x, self.y, senses.nearestPrey);
  const scmd = evalSeekCommander(self.x, self.y, senses.nearestCommander);
  const aw = evalAvoidWorker(self.x, self.y, senses.nearestWorker, drives.avoidWorker.triggerRadius);
  const sp = evalSpaceAlly(self.x, self.y, senses.allies, self, drives.spaceAlly.comfortRadius);
  const sa = evalSeekAlly(self.x, self.y, senses.allies, self);
  const fc = evalFollowCommander(self.x, self.y, senses.commander);

  let dx = 0;
  let dy = 0;
  dx += ap.dirX * ap.activation * drives.avoidPredator.weight;
  dy += ap.dirY * ap.activation * drives.avoidPredator.weight;
  dx += sn.dirX * sn.activation * drives.seekNutrient.weight;
  dy += sn.dirY * sn.activation * drives.seekNutrient.weight;
  dx += sprey.dirX * sprey.activation * drives.seekPrey.weight;
  dy += sprey.dirY * sprey.activation * drives.seekPrey.weight;
  dx += scmd.dirX * scmd.activation * drives.seekCommander.weight;
  dy += scmd.dirY * scmd.activation * drives.seekCommander.weight;
  dx += aw.dirX * aw.activation * drives.avoidWorker.weight;
  dy += aw.dirY * aw.activation * drives.avoidWorker.weight;
  dx += sp.dirX * sp.activation * drives.spaceAlly.weight;
  dy += sp.dirY * sp.activation * drives.spaceAlly.weight;
  dx += sa.dirX * sa.activation * drives.seekAlly.weight;
  dy += sa.dirY * sa.activation * drives.seekAlly.weight;
  dx += fc.dirX * fc.activation * drives.followCommander.weight;
  dy += fc.dirY * fc.activation * drives.followCommander.weight;

  const m = Math.sqrt(dx * dx + dy * dy);
  if (m < 0.001) return { dirX: 0, dirY: 0 };
  return { dirX: dx / m, dirY: dy / m };
}
