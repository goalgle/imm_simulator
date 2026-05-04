// 진입점 (entry).
// index.html 의 <script type="module" src="/src/main.ts"> 로 불려옴.

// Phaser: 라이브러리 import. 'phaser' 패키지의 default export = 네임스페이스 객체.
import Phaser from 'phaser';

// 게임: 우리가 정의한 게임 설정.
import { gameConfig } from './config';

// Phaser: new Phaser.Game(config) 가 게임을 시작하는 표준 방식.
//        내부에서 캔버스 생성 → 씬 로드 → 메인 루프(60fps) 시작.
//        반환된 인스턴스는 보통 사용 안 하므로 변수에 받지 않아도 됨.
new Phaser.Game(gameConfig);
