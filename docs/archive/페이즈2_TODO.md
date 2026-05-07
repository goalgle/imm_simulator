# 페이즈 2 작업 현황 + TODO

**작성**: 2026-05-07 (Session 16 종료 시점)
**관련 문서**:
- 기획서 §2.11 — 페이즈 2 진입/복귀 골격 (아키텍처)
- 기획서 §2.12 — 페이즈 2 게임 룰 (확정 사항 정본)
- 아이디어 기획서 §"바이러스 변이 시나리오 (총 6종)" — 변이 6종 명세

---

## 현재 상태 한 줄

페이즈 2 진입/복귀 + placeholder 컨텐츠 (DNA 나선, 바이러스 burst) 동작 + 도메인 변이 함수 완성. **실제 게임 룰 (wave / 쉴드 / hit count → 변이 판정 → 호중구 변이) 미적용**.

---

## 확정된 결정사항 (§2.12 정본)

| 항목 | 값 |
|---|---|
| Wave / 진입 | 페이즈 2 1회 진입 = 1 wave |
| Wave 당 바이러스 | **10발** 순차 spawn (시간차 ~0.8s) |
| 바이러스 패턴 | 직진 / 지그재그 / 커브 무작위 mix |
| 쉴드 charges | **8회** (10 - 8 = 최소 2발 통과) |
| 쉴드 지속 | ~0.5s |
| Wave 종결 | 10발 모두 처리 → 변이 판정 → 페이즈 1 복귀 |
| Hit → 변이율 | 매 hit +10% (누적 0~100%) |

### Hit → 변이 매핑 (deterministic)

| hits | 변이율 | 결과 |
|---|---|---|
| 0 | 0% | 정상 |
| 1~2 | 10~20% | 변이 1 좀비 |
| 3~4 | 30~40% | 변이 2 암세포 |
| 5~6 | 50~60% | 변이 3 형태 붕괴 |
| 7~8 | 70~80% | 변이 4 과민 |
| 9 | 90% | 변이 5 마비 |
| 10 | 100% | 변이 6 카오스 |

### 쉴드 / 바이러스 상극 매트릭스 (3×3)

| 쉴드 ↓ \ 바이러스 → | 직진 | 지그재그 | 커브 |
|---|---|---|---|
| **방패형** | ✅ | ❌ | ❌ |
| **그물형** | ❌ | ✅ | ❌ |
| **편향형** | ❌ | ❌ | ✅ |

UX: `[1]/[2]/[3]` 으로 쉴드 타입 선택 → 클릭으로 발동 (~0.5s).

### DNA 시각화

- 10 세그먼트 분할 (시각용 추상 — 게임 로직은 hit 카운트만 사용)
- 매 hit 마다 인덱스 0부터 순차로 corrupted (빨강 톤) 처리

---

## 완료된 작업

### Stage 0 — 디자인 락인 ✅
- 기획서 §2.12 신규 추가 (위 표들의 정본)

### Stage 1 — 도메인 (변이 함수) ✅
- `src/domain/mutations.ts` 신규
  - `cloneDna(dna)` (dna.ts 로 이동, mutations.ts 에서 re-export)
  - `mutationZombie / Cancer / Corruption / Hyperactive / Paralysis / Chaos`
  - `pickMutation(hits): MutationKind | null` — 결정형 매핑
  - `applyMutation(dna, kind, random?)` — 디스패치
- `tests/domain/mutations.test.ts` — 25 케이스 (clone 독립성, 각 변이 형질 변화, 매핑 boundary, chaos deterministic random)

### Stage 2 — 호중구 DNA 인스턴스화 ✅
- `src/domain/dna.ts`:
  - `DnaKind` 타입 (8종 string union)
  - `DNA.kind` 필드 추가 (변이 후 보존됨)
  - 모든 8 프리셋에 kind 값
  - `cloneDna(dna)` 이동
- `src/entities/LivingCell.ts`:
  - 생성자에서 `cloneDna` — 모든 cell 이 자기 DNA 인스턴스
  - `dna` 필드 readonly 제거 (Stage 6 의 setDna 대비)
  - `dnaKind` getter
- 11곳 reference 비교 → kind 비교 전환:
  - BloodScene.ts × 3
  - GraphicsCellRenderer.ts × 1 (isHeroDna 한 줄)
  - ContactSystem.ts × 2
  - TeamSystem.ts × 1 (priorityOf)
  - WhiteCellBehaviorSystem.ts × 4 (Stage 2 후속 버그픽스 포함)
- 사용 안 하게 된 import 정리

### Stage 2 후속 — 버그픽스 + Polish (페이즈 1 영향)
- 클론 후 `cell.dna !== BCELL` 항상 true → B세포 발사 정지 버그 수정 (`dnaKind !== 'BCELL'`)
- `findAllyTarget` 의 `ally.dna !== NEUTROPHIL` 동일 버그 수정 → fusion 정상 동작
- Fusion 조건 완화: WEAK_HP_THRESHOLD 0.25 → 0.50, FUSION_PADDING 2 → 20
- Fusion 애니메이션 추가 (약한 호중구가 강한 호중구로 ~0.35s 빨려들어감, 축소 + 페이드)
- 영양분 margin 100 → 160 (구석 쏠림 방지)
- 커맨더 진화 record requeue 로직 — 세균 전멸 후 [B] 스폰 시 자동 진화

---

## 남은 작업 (TODO)

### MVP 데모 경로 (Stage 4 쉴드 빼고 한 사이클 먼저)

#### Stage 3 — 페이즈 2 핵심 룰 (도메인 + UI)
- [ ] `WaveState` 데이터 추가 (BloodScene 또는 별도 모듈)
  - `viruses` 큐 (10발), `mutationRate`, `shieldCharges`, `currentShieldType`, `hits`
- [ ] DNA 시각화: `drawDnaHelix` 가 corrupted 인덱스 받아 세그먼트별 색
  - 현재 단일 그라데이션 → 10개 세그먼트로 분할 (인덱스 보유 + 색 분기)
- [ ] hit 처리: 도달 시 `wave.hits++`, 세그먼트 corrupted 표시, mutationRate += 10%
- [ ] HUD: 진행 상황 표시 (`hits/10`, `mutationRate%`, charges 잔여)

#### Stage 5 — Wave 자동 발사
- [ ] 페이즈 2 진입 시 10발 큐 생성 (직진:지그재그:커브 = 4:3:3 등 분포)
- [ ] 시간차 spawn (~0.8s 간격) — Phaser timer 또는 innerTime 기반 누적
- [ ] 모든 바이러스 처리 후 wave 종결 → Stage 6 트리거
- [ ] 현재 "클릭 = 바이러스 spawn" 동작 제거 (디버그용으로만 보존하거나 토글)

#### Stage 6 — 변이 판정 + 적용
- [ ] wave 종결 시점 `pickMutation(hits)` 호출
- [ ] `host.dna` 변이 적용 — handle 의 stale reference 문제 해결 필요 (아래 "열린 질문" 참조)
- [ ] "변이 N 발생" 텍스트 1~2초 표시 후 자동 페이즈 1 복귀

#### Stage 7 — 페이즈 1 복귀 후 변이 호중구 동작 검증
- [ ] 자동 반영 확인: 색/속도/turnRate/shape (시스템이 dna 매 프레임 읽음)
- [ ] **좀비 (target=-1)**: ContactSystem 에 호중구↔호중구 공격 분기 신규 필요 (현재 호중구↔세균만 검사)
- [ ] **카오스 (random target -1)**: 위와 동일 분기로 커버

### 풀 경로 추가 항목

#### Stage 4 — 쉴드 메커니즘
- [ ] `[1]/[2]/[3]` 키로 `currentShieldType: 'shield'|'net'|'deflect'` 변경 + HUD 표시
- [ ] 클릭 → 쉴드 발동 시각 (호중구 주변 링/콘) ~0.5s + charges -1
- [ ] 활성 시간 동안 매칭 패턴 바이러스 통과 시 차단 (소멸, hit 발생 X)
- [ ] HUD: charges 잔여 / 현재 shieldType / hits/10 / mutationRate%

#### Stage 8 — 진입 트리거 (디자인 결정 후)
- [ ] 페이즈 1 에 바이러스 엔티티 (세균에서 spawn? 외부 invasion?)
- [ ] 호중구↔바이러스 충돌 시 그 호중구를 host 로 페이즈 2 진입
- [ ] 현재 `[Z]` 디버그 키는 보존 (개발 편의)

#### Stage 9 — 시각 폴리싱
- [ ] 쉴드 시각 효과 디자인
- [ ] 변이 발생 시 호중구 변형 애니메이션 (트위닝 또는 0.5s 펄스)
- [ ] 페이즈 2 HUD 디자인 (현재 placeholder)
- [ ] 진단 로그 (`console.log` 다수) 정리

#### Stage 10 — 문서
- [ ] `시스템_구현_기획서.md` §2.11/§2.12 placeholder 문구를 실제 룰 진행 후 갱신
- [ ] §3.3 (DNA 키 ↔ 세그먼트 매핑) 채움 — 시각용 10 세그먼트 인덱스 결정 시
- [ ] §4 (변이 전파 모델) 과 §2.12 통합 — 본 §2.12 는 "변이 발생", §4 는 "변이가 분열로 전파"

---

## 열린 질문 / 미정 사항

### 변이 적용 시 handle DNA 갱신 (Stage 6 핵심)
현재 `WhiteCell` 생성자에서 `cloneDna` 후 `renderer.create(this.dna, x, y)` 호출 → `GraphicsHandle` 가 dna reference 보유. 변이 시 `host.dna = applyMutation(host.dna, kind)` 으로 reference 교체하면 **handle 의 dna 는 stale**.

**옵션 A**: `CellRenderHandle` 에 `setDna(dna)` 메서드 추가, WhiteCell.setDna 가 둘 다 갱신.
**옵션 B**: 변이 함수가 새 객체 반환 대신 in-place 변형. handle 의 reference 가 같은 객체라 자동 반영. (mutations.ts API 변경 필요 — 현재 immutable.)

→ **옵션 A 권장**. mutations.ts 의 immutability 보존 + 명시적 인터페이스.

### 좀비/카오스의 ContactSystem 분기 (Stage 7)
현재 ContactSystem 은 호중구↔세균 충돌만 검사. 좀비 호중구 (target=-1) 가 다른 호중구를 공격하려면:
- (a) 호중구↔호중구 페어 검사 추가, target=-1 일 때만 데미지 적용
- (b) 좀비 호중구를 "세균 진영"으로 전향시켜 기존 시스템 재활용 (target 값으로 구분 못 함 → kind 추가 라벨 필요?)

→ **(a) 권장**. 기존 시스템 침범 최소.

### 다중 변이 정책 (Stage 9)
이미 변이된 호중구가 다시 페이즈 2 진입 시:
- 추가 변이? (변이 위 변이)
- 무시? (한 번만 변이)
- 변이 해제 후 새 변이? (덮어씀)

→ MVP 단계에선 "한 번만 변이" 권장 (단순). 게임 디자인 결정 후 정책 결정.

### 진입 트리거 (Stage 8)
바이러스 침공 이벤트의 페이즈 1 발생 메커니즘 미정:
- 세균에서 발사? (B세포 항체와 비대칭)
- 시간 경과 시 자동? (스트레스 모델)
- 외부 invasion 이벤트?

→ MVP 데모 끝나고 게임플레이 보고 결정.

---

## 추천 진행 순서 (내일)

```
Stage 3 (Wave 데이터 + DNA 세그먼트 시각화 + hit 처리)
  ↓
Stage 5 (Wave 자동 발사)
  ↓
Stage 6 (변이 판정 + handle setDna 추가 + 변이 적용)
  ↓ MVP 동작 확인 시점
Stage 7 (좀비 ContactSystem 분기)
  ↓ 페이즈 1 변이 호중구 검증
Stage 4 (쉴드)
Stage 8~10 (진입 트리거 + 폴리싱 + 문서)
```

**최소 동작 데모 기준**: Stage 3+5+6 까지. "[Z] 진입 → 자동 wave 10발 → 무방비로 hit 누적 → 변이 N 적용 → 페이즈 1 복귀, 호중구 변형됨" 이 동작.

---

## 코드 위치 메모

### 페이즈 2 메인
- `src/scenes/BloodScene.ts`
  - `zoomIntoNeutrophil`, `enterInside`, `exitInside`
  - `updateInside`, `drawDnaHelix`
  - `spawnVirusBurst`, `spawnVirusAt`, `updateViruses`
  - 상태: `phase`, `hostCell`, `innerTime`, `viruses[]`, `dnaGfx`
  - 카메라/Layer: `cam2`, `outerLayer`, `innerLayer`, `routeAddedToOuter`, `addToInner`

### 도메인
- `src/domain/dna.ts` — `DnaKind`, `DNA.kind`, 8 프리셋, `cloneDna`
- `src/domain/mutations.ts` — 변이 6종, `pickMutation`, `applyMutation`
- `tests/domain/mutations.test.ts` — 25 테스트

### 호중구 변이 인프라
- `src/entities/LivingCell.ts` — `dna` 인스턴스, `dnaKind` getter, fusion 애니메이션 슬롯
- `src/entities/WhiteCell.ts` — fusion 상태/애니메이션, `mergeCounter`

### Phase 1 변이 호중구 동작 (Stage 7 작업 위치)
- `src/systems/ContactSystem.ts` — 호중구↔세균 검사 부분에 호중구↔호중구 분기 추가 예정
- `src/systems/WhiteCellBehaviorSystem.ts` — drives 의 target/seekPrey 가 자동 반영되는지 확인

---

## 참고: Session 16 종료 시점 테스트 상태

- `npm run typecheck` ✅
- `npm test` — 94/94 ✅
- 페이즈 1 수동 검증 ✅ (사용자 확인 완료 — fusion 애니메이션, 커맨더 진화, 영양분 margin)
- 페이즈 2 — 기술적 동작 ✅ (DNA 나선, 바이러스 burst). 게임 룰 미적용.
