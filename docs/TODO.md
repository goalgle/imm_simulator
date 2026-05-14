# TODO — 진행 중 작업

> **이 파일의 목적**: 다음 세션에 무엇을 할지. 휘발성 — 매 세션 갱신 가능.
>
> **출처**: 옛 `페이즈2_TODO.md` (Session 16 스냅샷) + Session 17 진행 + Stage 11~15 추가.

---

## 현재 상태 한 줄 (Session 20 종료 시점)

스테이지 시스템 (Session 20) — StageConfig 타입 + STAGE_1 (3분, 호중구 10/세균 3+커맨더 1, wave 60s/120s 에 +5). 시간 클리어 ★★★, 시간 초과 ★★/★, 호중구 전멸 실패. 카운트다운 HUD + 결과 모달. 대식세포 수동 조작 ← → (Session 19). 변이 6종 시스템 분기 (Stage 11~15) + 풍선 페이즈 2 (Session 18) + 관전/개입 모드 (Session 19).

---

## 확정된 결정사항 (Session 17)

| 항목 | 값 |
|---|---|
| Wave 진입 | 페이즈 2 1회 진입 = 1 wave |
| Wave 당 바이러스 | 10발 순차 spawn (시간차 0.8s) |
| 바이러스 패턴 분포 | 직진 4 / 지그재그 3 / 커브 3 (매 wave shuffle) |
| 바이러스 속도 | 40~80 px/s 랜덤 (도달 타이밍 분산) |
| 쉴드 | 단일 안 (3×3 매트릭스 폐기), 5 charges, 0.3s |
| 쉴드 시각 | DNA strand/pair 라인 두께 ↑ (별도 영역 X) |
| Hit → 변이율 | 매 hit +10% (누적 0~100%) |
| Hit → 변이 매핑 | 0=정상 / 1~2=좀비 / 3~4=암세포 / 5~6=붕괴 / 7~8=과민 / 9=마비 / 10=카오스 |

### 변이 timing 락인

| 변이 | 타이머 | 비고 |
|---|---|---|
| 암세포 | 분열 주기 6s, 1번만 | 자손은 정상 암세포로 머무름 |
| 붕괴 | scale 1 → 0 동안 5s | 소멸 후 페이즈 2 자동 진입 |
| 과민 | scale 1 → 2.5 동안 4s, 폭발 반경 200px | 본인 포함 영역 내 모두 즉사 |
| 마비 | 3s 주기 0.5s, 전파 반경 60px | 평상시 일반 호중구 동작 |

---

## 완료된 작업 (Stage 0~6 + 단일 쉴드 + 1단계 도메인)

### Stage 0 — 디자인 락인 ✅
- 시스템_구현 §2.12 (현 [변이.md](변이.md))

### Stage 1 — 도메인 (변이 함수) ✅
- `src/domain/mutations.ts` 신규 (cloneDna 이동, 6 변이 함수, pickMutation, applyMutation)
- `tests/domain/mutations.test.ts` (Session 17 갱신 시 26 케이스)

### Stage 2 — 호중구 DNA 인스턴스화 ✅
- `DnaKind` 타입, `DNA.kind` 필드, 8 프리셋 kind 값, 11곳 reference 비교 → kind 비교

### Stage 2 후속 — 페이즈 1 폴리싱 ✅
- B세포 발사 / fusion 버그 수정 (dna reference → kind 비교 누락 분)
- Fusion 조건 완화 (WEAK_HP_THRESHOLD 0.50, FUSION_PADDING 20)
- Fusion 애니메이션 (~0.35s 빨려들어감 + 축소 + 페이드)
- 영양분 margin 100 → 160
- 커맨더 진화 record requeue (전멸 후 [B] 스폰 시 자동 진화)

### Stage 3 — Wave 데이터 + DNA 10 세그먼트 + hit 처리 + HUD ✅
- `WaveState` 타입 (BloodScene), DNA_SEGMENTS=10, 인덱스 0 부터 corrupted 빨강 톤
- inside HUD (좌상단 진행 + 쉴드 상태)

### Stage 4 — 쉴드 (단일 안) ✅
- 5 charges, 0.3s, DNA 라인 두께 ↑ 펄스
- 클릭 = `tryActivateShield`
- updateViruses 의 hit 분기 — 쉴드 활성 시 hits 미증가 + 차단 이펙트 (시안 원 펄스)
- exitInside 시 wave/이펙트 정리

### Stage 5 — Wave 자동 발사 ✅
- enterInside 시 10발 큐 (4:3:3 분포 shuffle)
- innerTime 기반 spawn timer (0.8s 간격)
- 클릭 spawn 코드 + spawnVirusBurst 메서드 + VIRUS_BURST_* 상수 제거
- 바이러스 속도 40~80 랜덤 (직진/지그재그 speed + curve inwardSpeed 통일)

### Stage 6 — 변이 적용 + handle.setDna + 자동 복귀 ✅
- `CellRenderHandle.setDna(dna)` 인터페이스 + `GraphicsHandle.setDna` 구현
- `LivingCell.setDna(dna)` 헬퍼 (handle 도 같이 갱신)
- `WhiteCell.mutation: MutationKind | null` + `setMutation(kind)` (Session 17)
- `finalizeWave` — `pickMutation(hits)` → `applyMutation` → `host.setDna + setMutation`
- "변이 N 발생" 텍스트 1.5s 후 자동 페이즈 1 복귀

### 1단계 도메인 갱신 (Session 17) ✅
- mutations.ts 사용자 디자인 반영 (암세포 base/w1.A 제거, 마비 omega/speed 제거 등)
- WhiteCell.mutation 필드
- 기획서 §2.12 갱신 (쉴드 단일화, 변이 6종 메커니즘 표, Stage 11~15)
- mutations.test.ts 26 케이스
- **typecheck ✅ + 95/95 ✅**

### Session 17 폴리싱 ✅
- 쉴드 차단 소멸 이펙트 (시안 원 펄스 0.25s)
- 페이즈 2 진입 시 NEUTROPHIL 후보 중 무작위 선정

### docs 재정리 (Session 17) ✅
- 두 큰 단일 파일 → 7개로 분리, A/B/C 옵션 보존, archive 백업

---

## 남은 작업

### MVP 데모 다음 단계 — 변이별 시스템 메커니즘 (Stage 11~15)

각 stage 는 페이즈 1 시스템 분기 추가가 필요해 회귀 위험. 단계별 검증 (typecheck + 도메인 테스트 + 수동 동작) 후 다음 stage 로.

#### Stage 11 — 좀비 + 카오스 (호중구↔호중구 분기 공유)
- [ ] ContactSystem: 호중구↔호중구 페어 검사 추가
  - mutation==='zombie' → 데미지 ×2 (호중구 vs)
  - mutation==='chaos' → 데미지 ×3 (호중구 + 세균 모두)
- [ ] WhiteCellBehaviorSystem:
  - zombie 호중구는 fusion 후보에서 제외
  - zombie/chaos 의 prey 후보 = 살아있는 호중구 (chaos 는 +세균)

#### Stage 12 — 암세포
- [ ] WhiteCell cancer 모드 — updateAlive 분기: 행동 정지 + 즉시 큰 Y 낙하
- [ ] 분열 timer (6s) → 좌우 새 암세포 spawn (양쪽 임펄스)
- [ ] MacrophageSystem: 좌우 이동 경로에 암세포 충돌 → 정지 / 우회

#### Stage 13 — 붕괴 ✅
- [x] WhiteCell corruption 모드 — 매 프레임 scale 점감 (5s, 1→0)
- [x] scale 0 도달 시 자기 소멸 + BloodScene 에 페이즈 2 자동 진입 시그널 (다른 호중구 호스트로)

#### Stage 14 — 과민 ✅
- [x] WhiteCell hyperactive 모드 — 매 프레임 scale 점증 (4s, 1→2.5)
- [x] 임계 도달 시 폭발: 반경 200px 내 살아있는 호중구/세균 즉사 + 본인 소멸
- [x] BloodScene.checkHyperactiveTrigger — pendingHyperactiveExplosion 검사 + 영역 데미지

#### Stage 15 — 마비 ✅
- [x] WhiteCell paralysis 모드 — 3s 주기 0.5s 마비 timer (isParalyzed)
- [x] WhiteCell.updateAlive: paralyzed 면 vx/vy=0 강제 (BehaviorSystem 의 desired 가 매 프레임 덮여도 정지)
- [x] BloodScene.checkParalysisPropagation — 인접 60px 정상 호중구 paralyzedUntil 갱신 (1단계 전파)

### 풀 경로 추가 항목

#### Stage 8 — 진입 트리거 (디자인 결정 후)
- [ ] 페이즈 1 의 바이러스 침공 이벤트 (세균에서 spawn? 외부 invasion? 시간 경과?)
- [ ] 호중구↔바이러스 충돌 시 그 호중구를 host 로 페이즈 2 진입
- [ ] 현재 [Z] 디버그 키는 보존

#### Stage 9 — 시각 폴리싱
- [ ] 변이 발생 시 호중구 변형 애니메이션 (트위닝 또는 0.5s 펄스)
- [ ] 폭발/분열/마비 시각 효과 디자인
- [ ] 페이즈 2 HUD 디자인 (현재 placeholder)
- [ ] 진단 `console.log` 다수 정리

#### Stage 10 — 문서 추가
- [ ] [변이.md](변이.md) 의 옵션 A/B/C 통합 결정 후 단일 정본화
- [ ] [컨셉.md](컨셉.md) 의 의학적 7종 vs 코드 8 프리셋 정합
- [ ] [컨셉.md](컨셉.md) §7 옛 약화 모델 vs 코드 HP 모델 정합
- [ ] [컨셉.md](컨셉.md) §8 옛 tempState vs 코드 VisualState 3채널 정합

---

## 열린 질문 / 미정 사항

### 변이별 시스템 분기 — 세부 디자인 (Stage 11~15 진행 시 결정)
- 좀비의 호중구 추적 — drives.seekPrey 활성? 또는 별도 drive 추가?
- 암세포 분열 후 자손은 변이 mutation 라벨 유지? 또는 정상 호중구로?
- 붕괴 소멸 시 페이즈 2 자동 진입의 host 선정 — 가장 가까운 호중구? 무작위?
- 과민 폭발 시각 — 화면 흔들림 추가? 큰 원 펄스로 충분?
- 마비 전파 — 한 단계만? 또는 연쇄 (호중구 A 가 B 마비, B 가 C 마비)?

### 다중 변이 정책
Session 17 잠정 결정: **새 변이가 기존을 덮어씀** (단순). 게임 디자인 검토 후 재정의 가능.

### 카오스 vs 좀비 충돌
카오스 호중구가 좀비 호중구를 만나면? 양쪽 다 공격 가능 (카오스는 모두 적, 좀비는 호중구 적). MVP 단계엔 자연 발생 — 추가 분기 불필요.

### 진입 트리거 (Stage 8)
바이러스 침공 이벤트의 페이즈 1 발생 메커니즘 미정. MVP 끝나고 게임플레이 보고 결정.

### 옵션 A/B/C 영역 통합 결정 ([변이.md](변이.md), [컨셉.md](컨셉.md))
- 백혈구 종족 (의학적 7종 vs 코드 8 프리셋)
- 변이 6종 dna 변경값 (옛 안 vs Session 17 vs 코드)
- 접촉 반응 (옛 tempState vs 코드 VisualState)
- 약화 모델 (옛 weakness vs 코드 HP)
- DNA 시각화 16진수 코드 (옛 안 vs §3.2 폐기 결정)

---

## 추천 진행 순서

```
Stage 11 (좀비 + 카오스 — 호중구↔호중구 분기 공유)
  ↓ 검증 (페이즈 1 회귀 없음 확인)
Stage 12 (암세포 — 정지/낙하/분열)
  ↓
Stage 13 (붕괴 — scale 점감 + 자동 페이즈 2 재진입)
  ↓
Stage 14 (과민 — scale 점증 + 폭발)
  ↓
Stage 15 (마비 — 3s 주기 + 전파)
  ↓
Stage 8~10 (진입 트리거, 폴리싱, 옵션 A/B/C 통합)
```

**최소 데모 기준**: Stage 11 까지. "좀비 호중구가 다른 호중구를 공격하는 것" 이 페이즈 1에서 확인되면 변이 시스템 메커니즘 핵심 검증.

---

## 코드 위치 메모

### 도메인
- `src/domain/dna.ts` — DNA 타입, DnaKind, 8 프리셋, cloneDna
- `src/domain/mutations.ts` — 변이 6종, pickMutation, applyMutation, MutationKind

### 변이 적용 인프라
- `src/entities/LivingCell.ts` — dna 인스턴스, dnaKind getter, setDna
- `src/entities/WhiteCell.ts` — mutation 필드, setMutation, fusion 애니메이션, mergeCounter, level
- `src/render/CellRenderer.ts` — CellRenderHandle.setDna 인터페이스
- `src/render/GraphicsCellRenderer.ts` — GraphicsHandle.setDna 구현

### 페이즈 2 메인
- `src/scenes/BloodScene.ts`
  - `zoomIntoNeutrophil`, `enterInside`, `exitInside`, `updateInside`
  - `drawDnaHelix(t, hits, shieldActive)`
  - `spawnVirusAt`, `updateViruses`
  - `tryActivateShield`, `isShieldActive`, `spawnShieldHitEffect`, `updateShieldHitEffects`
  - `finalizeWave` — pickMutation → applyMutation → setDna + setMutation
  - 상태: `phase`, `hostCell`, `innerTime`, `viruses[]`, `shieldHitEffects[]`, `waveState`, `dnaGfx`
  - 카메라/Layer: `cam2`, `outerLayer`, `innerLayer`, `routeAddedToOuter`, `addToInner`

### Stage 11~15 작업 위치 (예정)
- `src/systems/ContactSystem.ts` — 호중구↔호중구 분기 추가 (Stage 11)
- `src/systems/WhiteCellBehaviorSystem.ts` — fusion 분기 제외, prey 후보 변경 (Stage 11), paralyzed 입력 무시 (Stage 15)
- `src/systems/MacrophageSystem.ts` — 암세포 충돌 (Stage 12)
- `src/entities/WhiteCell.ts` — 변이별 모드 (cancer/corruption/hyperactive/paralysis) timer (Stage 12~15)
- `src/scenes/BloodScene.ts` — 폭발 영역 데미지 헬퍼, 붕괴 자동 페이즈 2 시그널 (Stage 13/14)

---

## Session 17 종료 시점 테스트 상태

- `npm run typecheck` ✅
- `npm test` 95/95 ✅
- 수동 검증 ✅ (페이즈 1 fusion/커맨더 진화/영양분, 페이즈 2 wave/쉴드/변이 적용/자동 복귀)
