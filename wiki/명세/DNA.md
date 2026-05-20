# DNA — 정본 스키마

> `src/domain/dna.ts` 의 코드와 1:1.
> 변이는 [페이즈2.md](페이즈2.md), 새 종족 추가는 [아키텍처.md §7](아키텍처.md#7-새-종족-추가-가이드).

## 1. 원칙

- **DNA 가 유일한 정본**. UI 코드 (해시), 미니게임 segments 같은 표현은 단방향 파생.
- **모든 형질이 숫자** (또는 숫자만 든 객체) — 변이가 산술 연산 (`weight *= 1.3`) 으로 일관 처리되도록.
- **각 cell 이 자기 인스턴스 보유** — preset reference 공유 X. `cloneDna(preset)` 으로 생성. 변이가 다른 cell 로 새지 않게.
- **`dna.kind` 라벨로 종족 비교** — `cell.dna === NEUTROPHIL` 같은 reference 비교 금지. 변이 후에도 `kind` 는 보존.

## 2. 타입 구조

```typescript
type DNA = {
  kind: DnaKind;
  shape:    { base: number; w1: Wave; w2: Wave; w3: Wave };
  color:    { h: number; s: number; l: number };
  behavior: {
    target: number;          // legacy (drives 로 대체)
    speed: number;           // 이동 속도 (px/s)
    contact: number;         // 접촉 시각 자극 강도
    turnRate: number;        // 1/sec — desired velocity 로의 수렴 속도
    minSpeedRatio: number;   // HP 줄어도 속도 캡 (0=비례, 1=무관)
  };
  drives:   Drives;          // 8 종 동기 가중치 (아래)
  combat:   { maxHp: number; attack: number };
  command:  Command;         // 지휘 형질 (지휘관 아니면 모두 0)
  armament: Armament;        // 발사체 형질 (B세포만 사용)
  meta:     { recovery: number; divide: number };
};

type Wave = { A: number; n: number; omega: number };

type DnaKind =
  | 'NEUTROPHIL' | 'NEUTROPHIL_SUPER' | 'NK_CELL' | 'BCELL' | 'TCELL'
  | 'BACTERIA_A' | 'BACTERIA_COMMANDER' | 'MACROPHAGE';
```

## 3. shape — `r(θ, t)` 함수의 파라미터

```
r(θ, t) = base + Σ (base · A_i · sin(n_i · θ + ω_i · t + phase_i))
```

| 필드 | 의미 |
|---|---|
| `base` | 평균 반지름 (px). 시각적 크기. |
| `w1.A` | 진폭 — base 대비 비율 (0~1 권장). 클수록 변형 큼 |
| `w1.n` | 각주파수. 2π 안 돌기 수 (n=2: 타원, n=4: 4 돌기) |
| `w1.omega` | 시간주파수 (rad/sec). 클수록 빠르게 출렁 |
| `w2`, `w3` | 같은 구조. 보통 중주파/고주파 — n 큼, omega 큼 |

`phase` 는 spawn 시 무작위로 한 번 정해진 후 고정 — 동일 종 간 동기화 방지.

## 4. drives — 8 종 동기

```typescript
type Drives = {
  avoidPredator:   { weight: number; triggerRadius: number };
  seekNutrient:    { weight: number };
  seekPrey:        { weight: number };
  seekCommander:   { weight: number };                        // NK 사용
  avoidWorker:     { weight: number; triggerRadius: number }; // NK 사용
  spaceAlly:       { weight: number; comfortRadius: number };
  seekAlly:        { weight: number };
  followCommander: { weight: number };
};
```

| drive | 동작 |
|---|---|
| `avoidPredator` | 가장 가까운 적 종족이 `triggerRadius` 안에 있을 때만 활성, 가까울수록 ↑ |
| `seekNutrient` | 영양분 있으면 항상 활성. 가장 가까운 영양분으로 |
| `seekPrey` | 백혈구가 세균을 추적 |
| `seekCommander` | NK 가 적 진영 커맨더를 1순위로 |
| `avoidWorker` | NK 가 일반 세균은 회피하며 우회 |
| `spaceAlly` | 동족이 `comfortRadius` 안이면 멀어짐 |
| `seekAlly` | 군집형. T세포가 호중구 따라다닐 때 |
| `followCommander` | 팀 멤버가 지휘범위 밖이면 끌려옴 |

**결합 공식** (`computeDesiredDirection`):
1. 각 drive 평가 → (단위 방향 벡터, 활성도 0~1)
2. 가중 합: `Σ dir × activation × weight`
3. 정규화 → 단위 방향
4. desired velocity = 방향 × `behavior.speed × effectiveRatio`
5. 부드러운 가속: `v += (desired_v - v) × (1 - exp(-turnRate × dt))`

`effectiveRatio = max(hpRatio, minSpeedRatio)` — HP 영향 캡.

## 5. command — 지휘 형질

```typescript
type Command = {
  visionRange: number;
  commandRange: number;
  visionGrowth: number;
  commandGrowth: number;
  baseTeamSize: number;
  teamSizeStep: number;
  levelUpAbsorbCount: number;
};
```

| 필드 | 의미 |
|---|---|
| `visionRange` | 시야 (호중구 인식 거리). `avoidPredator.triggerRadius` 와 별개 — 팀 모드 결정용 |
| `commandRange` | 지휘 범위 (멤버 영입/유지 거리). ×1.5 멀어지면 자동 탈퇴 |
| `visionGrowth` | 영양분 1개 흡수당 visionRange 증가량 |
| `commandGrowth` | 영양분 1개 흡수당 commandRange 증가량 |
| `baseTeamSize` | 0 = 지휘관 아님. ≥1 = 지휘관 (초기 max) |
| `teamSizeStep` | 몇 레벨마다 maxTeamSize +1 |
| `levelUpAbsorbCount` | 영양분 몇 개 흡수 = 1 레벨업 |

**지휘관 판정**: `baseTeamSize ≥ 1`. T세포는 `baseTeamSize=0` 이라 지휘관 아님 (`isCommander()` false) — 호중구 진화는 별도 메커니즘.

## 6. armament — 발사체 형질 (B세포 전용)

```typescript
type Armament = {
  fireRange: number;        // 표적 인식 거리
  fireCooldown: number;     // 발사 주기 (초)
  projectileSpeed: number;  // 발사체 속도 (px/s)
  projectileDamage: number; // 데미지 (세균 흡수 시 hp 감소)
  projectileRange: number;  // 사거리 (px). 만료 시 정지 = 지뢰화
};
```

B세포 이외 종은 모두 0.

## 7. 8 프리셋 — 비교표

### 백혈구

| 형질 | NEUTROPHIL | SUPER | NK_CELL | BCELL | TCELL | MACROPHAGE |
|---|---|---|---|---|---|---|
| base | 16 | 20 | 13 | 10 | 12 | 13 |
| color (hsl) | 322,53,81 | 280,65,55 | 240,70,25 | 232,50,70 | 186,50,40 | 120,30,50 |
| speed | 15 | 32 | 30 | 5 | 25 | 40 |
| turnRate | 1.5 | 2.0 | 3.0 | 1.0 | 3.0 | 0 |
| minSpeedRatio | 0 | 0 | 1.0 | 0 | 0 | 0 |
| maxHp | 100 | 180 | 80 | 50 | 100 | 200 |
| attack | 20 | 30 | 35 | 0 | 0 | 0 |
| recovery | 0.6 | 0.7 | 0.8 | 0.4 | 0.6 | 0 |

drives (백혈구):

| 종 | seekPrey | seekCommander | avoidWorker | seekAlly | spaceAlly |
|---|---|---|---|---|---|
| NEUTROPHIL | 1.0 | 0 | 0 | 0 | 0 |
| SUPER | 1.0 | 0 | 0 | 0 | 0 |
| NK_CELL | 0.7 (fallback) | 1.5 | 0.4 / r=80 | 0 | 0 |
| BCELL | 0 | 0 | 0 | 0 | 0 |
| TCELL | 0 | 0 | 0 | 1.0 | 0.2 / r=50 |
| MACROPHAGE | 0 (모두) | 0 | 0 | 0 | 0 |

### 세균

| 형질 | BACTERIA_A | BACTERIA_COMMANDER |
|---|---|---|
| base | 9 | 10 |
| color (hsl) | 0,0,30 (어두운 회색) | 330,50,25 (짙은 자주) |
| speed | 30 | 25 |
| turnRate | 3.0 | 2.5 |
| maxHp | 60 | 120 |
| attack | 15 | 25 |
| avoidPredator | 1.0 / r=180 | 1.5 / r=180 |
| seekNutrient | 0.6 | 0.7 |
| spaceAlly | 0.3 / r=50 | 0.2 / r=60 |
| followCommander | 0.7 | 0 |
| command.visionRange | 180 (회피) | 540 (팀 결정) |
| command.commandRange | 0 | 120 |
| command.baseTeamSize | 0 | 3 |
| command.levelUpAbsorbCount | 0 | 5 |

### BCELL armament

| 필드 | 값 |
|---|---|
| fireRange | 250 |
| fireCooldown | 3.0 s |
| projectileSpeed | 40 |
| projectileDamage | 15 |
| projectileRange | 250 |

## 8. WhiteCell.mutation — 변이 라벨

DNA 와 별개로 호중구는 변이 라벨을 보유:

```typescript
type MutationKind = 'zombie' | 'cancer' | 'corruption' | 'hyperactive' | 'paralysis' | 'chaos';
class WhiteCell extends LivingCell {
  mutation: MutationKind | null = null;
  setMutation(kind: MutationKind | null): void { this.mutation = kind; }
}
```

**왜 dna.kind 에 안 넣는가**: 변이 후에도 정체성은 호중구 (`kind='NEUTROPHIL'`). dna 는 시각·기본 행동만 바꾸고, "정지/낙하/분열/scale 점감/폭발/마비 timer" 같은 메커니즘은 시스템이 `mutation` 필드로 분기. 자세한 분기는 [페이즈2.md](페이즈2.md).

## 9. cloneDna

```typescript
function cloneDna(dna: DNA): DNA {
  return JSON.parse(JSON.stringify(dna)) as DNA;
}
```

- JSON 방식. hot path 아니므로 OK (cell 생성 시 1회, 변이 적용 시 1회).
- `kind` 등 모든 필드 자동 보존.

## 10. 파생 (UI 코드 / segments) — 후보로만 남김

```typescript
function dnaToCode(dna: DNA): string {
  // 정보 손실 OK — 시각적 식별자 용도
  // 17개 float → 16 nibble 양자화 → "#A34C-5F2E-..."
}
```

**현재 미구현**. 게임 UI 에 DNA 해시가 필요한 시점에 추가. 단방향만 (코드 → DNA 복원 X).

미니게임 segments 도 마찬가지로 정본의 *뷰*. 모든 변경은 정본을 거쳐야 함 — 현재 페이즈 2 의 10 세그먼트는 시각용 추상이고, 실제 변이는 `pickMutation(hits)` 결정형이라 segments 와 무관.
