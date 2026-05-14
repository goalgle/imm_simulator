// Phaser 게임 인스턴스에 넘기는 설정 객체.
// "Phaser:" 항목은 Phaser 가 정의/요구하는 것, "게임:" 항목은 우리 프로젝트의 결정.

import Phaser from 'phaser';
import { BloodScene } from './scenes/BloodScene';

// 게임: URL 파라미터 ?mobile / ?portrait / ?sim — 화면 모드 (Session 20).
//   기본:       창 전체 (Scale.RESIZE). 모바일 디바이스에서 접속 시 자동 풀스크린.
//   ?mobile / ?portrait : 기본과 동일하지만 후속 UI 분기에 사용 (현재는 marker 만).
//   ?sim       : 데스크탑 브라우저용 portrait 시뮬레이션 박스 (450×800 FIT, 검수용).
//                실제 모바일에서 letterbox 생기는 원인이라 별도 옵션으로 분리.
const params = new URLSearchParams(window.location.search);
const isSimBox = params.has('sim');

const SIM_BOX_WIDTH = 450;
const SIM_BOX_HEIGHT = 800;

// Phaser: GameConfig 의 타입은 Phaser 가 제공. 어떤 키가 유효한지 IDE 가 알려줌.
export const gameConfig: Phaser.Types.Core.GameConfig = {
  // Phaser: 렌더러 선택. WEBGL / CANVAS / AUTO 중 하나.
  // 게임:   WEBGL 고정 — M0 측정도 WebGL 기준이고, polygon 다수 렌더에 유리.
  type: Phaser.WEBGL,

  // 게임: 캔버스 크기 — sim 박스만 고정, 나머지 (모바일/데스크탑) 는 창 전체.
  width: isSimBox ? SIM_BOX_WIDTH : window.innerWidth,
  height: isSimBox ? SIM_BOX_HEIGHT : window.innerHeight,

  // 게임: 배경 색. 거의 검정 — 혈관 속 어둠 컨셉.
  backgroundColor: '#0a0a0a',

  // Phaser: 게임에 등록할 Scene 목록. 배열의 첫 번째가 자동으로 시작됨.
  // 게임:   장면 2(세포 속)는 BloodScene 안에 phase='inside' 로 통합 (보조 카메라 + Layer).
  scene: [BloodScene],

  // Phaser: Scale Manager 설정. 창 크기 변화 / 캔버스 정렬 방식.
  scale: {
    // Phaser: sim 박스 = FIT (고정 비율 letterbox), 나머지 = RESIZE (창 따라 캔버스 변경).
    //   RESIZE = letterbox 없이 항상 풀스크린. 모바일 디바이스에서 자동 적응.
    mode: isSimBox ? Phaser.Scale.FIT : Phaser.Scale.RESIZE,
    // Phaser: 캔버스를 부모(=body)의 가운데 정렬.
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
