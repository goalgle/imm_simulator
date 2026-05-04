// 형태 함수 r(θ, t).
// 아이디어 기획서 §아메바 형태 오브젝트 수학적 설계 + §접촉 반응 시스템.
// 이 파일은 Phaser 의존 없음 (도메인 계층, 단위 테스트 가능).
//
// M1 범위: DNA 만 반영. tempState (간섭, 감쇠, 위상 충격) 는 M2 에서 추가.

import type { DNA } from './dna';

export type Point = { x: number; y: number };

// 게임: 단일 각도 θ 에서의 반지름 평가.
//   dna       : 세포의 정본 DNA
//   theta     : 각도 (라디안, 0 ~ 2π)
//   t         : 시간 (초)
//   phase     : DNA 다양성 시뮬레이션을 위한 위상 오프셋. 같은 DNA 라도 phase 가 다르면
//               떨림이 동기화되지 않아 군집이 자연스러워 보임.
//   ampBoost  : wave 진폭 배율 (기본 1). 충격파/접촉 등 임시 자극으로
//               형태가 더 출렁이는 효과를 줄 때 > 1 (예: 1.5).
//               base 자체는 영향받지 않으므로 평균 크기는 유지되고 변형만 강화됨.
export function evaluateRadius(
  dna: DNA,
  theta: number,
  t: number,
  phase = 0,
  ampBoost = 1,
): number {
  const s = dna.shape;
  return (
    s.base +
    s.base * s.w1.A * ampBoost * Math.sin(s.w1.n * theta + s.w1.omega * t + phase) +
    s.base * s.w2.A * ampBoost * Math.sin(s.w2.n * theta + s.w2.omega * t + phase) +
    s.base * s.w3.A * ampBoost * Math.sin(s.w3.n * theta + s.w3.omega * t + phase)
  );
}

// 게임: 세포 1개의 polygon 점 배열 생성. 원점(0,0) 기준 로컬 좌표.
//   화면 위치는 호출자(렌더러)가 transform 으로 처리.
//   out 파라미터: 사전 할당된 버퍼를 넘기면 객체 생성을 피해 GC 부담 ↓.
//                 매 프레임 호출되므로 hot path 최적화 의도.
//   ampBoost   : evaluateRadius 의 ampBoost 동일.
export function generatePolygon(
  dna: DNA,
  t: number,
  vertexCount: number,
  phase = 0,
  ampBoost = 1,
  out?: Point[],
): Point[] {
  const result = out ?? new Array<Point>(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const theta = (i / vertexCount) * Math.PI * 2;
    const r = evaluateRadius(dna, theta, t, phase, ampBoost);
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    if (out) {
      result[i].x = x;
      result[i].y = y;
    } else {
      result[i] = { x, y };
    }
  }
  return result;
}
