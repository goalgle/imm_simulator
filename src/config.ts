// Phaser 게임 인스턴스에 넘기는 설정 객체.
// "Phaser:" 항목은 Phaser 가 정의/요구하는 것, "게임:" 항목은 우리 프로젝트의 결정.

import Phaser from 'phaser';
import { BloodScene } from './scenes/BloodScene';

// Phaser: GameConfig 의 타입은 Phaser 가 제공. 어떤 키가 유효한지 IDE 가 알려줌.
export const gameConfig: Phaser.Types.Core.GameConfig = {
  // Phaser: 렌더러 선택. WEBGL / CANVAS / AUTO 중 하나.
  // 게임:   WEBGL 고정 — M0 측정도 WebGL 기준이고, polygon 다수 렌더에 유리.
  type: Phaser.WEBGL,

  // 게임: 캔버스 크기. 창 전체 사용 결정 (scale 옵션과 함께).
  width: window.innerWidth,
  height: window.innerHeight,

  // 게임: 배경 색. 거의 검정 — 혈관 속 어둠 컨셉.
  backgroundColor: '#0a0a0a',

  // Phaser: 게임에 등록할 Scene 목록. 배열의 첫 번째가 자동으로 시작됨.
  // 게임:   MVP 는 장면 1(혈관 속) 만 → BloodScene 하나만 등록.
  //         장면 2(세포 속) 추가 시 여기에 함께 나열.
  scene: [BloodScene],

  // Phaser: Scale Manager 설정. 창 크기 변화 / 캔버스 정렬 방식.
  scale: {
    // Phaser: RESIZE = 창 리사이즈 시 캔버스도 함께 리사이즈.
    mode: Phaser.Scale.RESIZE,
    // Phaser: 캔버스를 부모(=body)의 가운데 정렬.
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
