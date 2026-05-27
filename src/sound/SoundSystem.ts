// 사운드 시스템 — Tone.js 기반 procedural audio.
// 파일 X — 모든 사운드는 함수 합성 (게임 디자인 미학과 일관: 세포 = 함수 = 사운드도 함수).
//
// 모바일 제약: AudioContext 는 사용자 인터렉션 후에만 시작 가능.
//   첫 pointerdown/keydown 에서 ensureStarted() 호출 필요.
//
// 사용:
//   const sound = new SoundSystem();
//   scene.input.once('pointerdown', () => sound.ensureStarted());
//   // 게임 이벤트에서:
//   sound.playWhiteCellDeath();
//   sound.playBacteriaDeath();

import * as Tone from 'tone';

// 게임: 접촉 멜로디 노트 풀 — C 메이저 펜타토닉 (불협 없음). 매 trigger 무작위 선택.
//   "딩딩딩~딩" 톤 — 가벼운 벨 같은 느낌. 격렬 전투 시 자연스럽게 연속 연주됨.
const CONTACT_NOTES = ['C5', 'D5', 'E5', 'G5', 'A5'];

// 게임: 싱글톤 인스턴스 — Phaser scene.restart() 마다 새 SoundSystem 생성하면 synth 누적되어
//   메모리/오디오 노드 누수. 첫 호출에 만들고 이후엔 같은 인스턴스 재사용.
let SHARED: SoundSystem | null = null;
export function getSoundSystem(): SoundSystem {
  if (SHARED === null) SHARED = new SoundSystem();
  return SHARED;
}

export class SoundSystem {
  private started = false;
  // 게임: 호중구 사망 — A3 → D3 글라이드 다운. 기운 빠지는 톤.
  private whiteDeathSynth: Tone.Synth;
  // 게임: 세균 사망 — A4 → E5 글라이드 업. 상쾌한 톤.
  private bacteriaDeathSynth: Tone.Synth;
  // 게임: 접촉 멜로디 — PluckSynth (현 튕기는 벨 느낌). 짧고 가벼움.
  private contactPluck: Tone.PluckSynth;

  constructor() {
    // 게임: 마스터 볼륨 — 게임 사운드가 너무 크지 않게 -10dB.
    Tone.getDestination().volume.value = -10;

    // 게임: 호중구 사망 — sine 부드러움 + 길어진 release. "기운빠짐" 톤.
    //   두 노트 trigger (A3 0.15s → D3 0.4s) 로 하강 시퀀스 표현.
    this.whiteDeathSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 },
    }).toDestination();

    // 게임: 세균 사망 — triangle. 상승 시퀀스 (A4 0.1s → E5 0.15s) 로 "상쾌" 톤.
    this.bacteriaDeathSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.05, sustain: 0.1, release: 0.1 },
    }).toDestination();

    // 게임: 접촉 멜로디 — PluckSynth (Karplus-Strong) 가 가장 "딩" 같은 톤.
    //   attackNoise 낮춤 + resonance 0.7 — 부드러운 벨/소거리.
    this.contactPluck = new Tone.PluckSynth({
      attackNoise: 0.5,
      dampening: 4000,
      resonance: 0.7,
    }).toDestination();
    // 게임: 접촉 사운드는 본 사운드보다 더 작게 (배경 느낌).
    this.contactPluck.volume.value = -16;
  }

  // 게임: AudioContext 시작 — 첫 사용자 인터렉션 (pointerdown/keydown) 안에서 호출.
  //   여러 번 호출돼도 안전 (started flag).
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.started = true;
  }

  // 게임: 호중구 (NEUTROPHIL/NK/BCELL/TCELL/SUPER) 사망 — 하강 두 노트로 "기운빠짐".
  playWhiteCellDeath(): void {
    if (!this.started) return;
    const now = Tone.now();
    this.whiteDeathSynth.triggerAttackRelease('A3', 0.15, now);
    this.whiteDeathSynth.triggerAttackRelease('D3', 0.5, now + 0.12);
  }

  // 게임: 세균 (BACTERIA_A/COMMANDER) 사망 — 상승 두 노트로 "상쾌".
  playBacteriaDeath(): void {
    if (!this.started) return;
    const now = Tone.now();
    this.bacteriaDeathSynth.triggerAttackRelease('A4', 0.08, now);
    this.bacteriaDeathSynth.triggerAttackRelease('E5', 0.12, now + 0.06);
  }

  // 게임: 호중구↔세균 접촉 중 "딩" — 펜타토닉 무작위 노트, 짧은 pluck.
  //   매 페어가 확률적으로 trigger (BloodScene.notifyContacts) → 자연스러운 멜로디.
  playContact(): void {
    if (!this.started) return;
    const note = CONTACT_NOTES[Math.floor(Math.random() * CONTACT_NOTES.length)];
    this.contactPluck.triggerAttackRelease(note, '16n');
  }
}
