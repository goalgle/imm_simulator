# 면역 시뮬레이션 게임 - 오브젝트 설계

**문서 버전**: v0.2  
**최종 수정**: 2026-05-01  
**상태**: 기획 단계 (코드 작성 전)

---

## 세션 히스토리 📝

### Session 1 (2026-05-01)

- [x] 아메바 형태 오브젝트 수학적 설계 (극좌표 변조 + 노이즈)
- [x] 백혈구 종류별 파라미터 정의 (7종)
- [x] 세균 접촉 반응 시스템 (간섭파 + 감쇠)
- [x] 바이러스 DNA 변이 시스템 (6종 변이)
- [x] 백혈구 vs 세균 전투 시스템 (약화, 고름, 청소)
- [x] 장면 전환 시스템 (혈관 속 ↔ 세포 속)
- [ ] 장면 2 미니게임 설계 (다음 세션)

---

## 프로젝트 개요

- **컨셉**: 바이러스/세균 침입 시 백혈구와 신체 세포의 염증반응을 게임으로 시각화
- **게임 타입**: 시뮬레이션 (최소 유저 인터렉션)
- **렌더링 방식**: 함수 기반 절차적 생성 (비트맵 이미지 미사용)

---

## 핵심 장면 흐름 🎬

### 1. 모든 세포의 움직임은 함수로 표현된다

```
r(θ, t) = DNA 파라미터 + 임시 상태
```

### 2. 이 움직임을 표현하는 데이터가 DNA다

```javascript
DNA = {
  shape: { base: 10, w1: { A: 0.3, n: 4, ω: 2.5 }, ... },
  color: { h: 200, s: 60, l: 70 },
  behavior: { target: 1.0, speed: 1.0, contact: 0.35 },
  meta: { recovery: 0.6, divide: 0.0 }
}
```

### 3. 세균과의 접촉은 DNA를 바꾸지 못하고 함수에만 영향을 준다

```javascript
// 세균 접촉 시
tempState.interference = 0.35;  // 임시 상태만 변경
tempState.damping = 1.0;
// DNA는 그대로!

// 렌더링 함수에서 DNA + 임시 상태 조합
r(θ, t) = DNA.shape.base 
        + [DNA.shape.w1.A × (1 - tempState.interference)] × tempState.damping
        + ...
```

### 4. 바이러스는 DNA를 직접 일부 편집한다

```javascript
// 바이러스 침투 시
virus.infect(cell) {
  cell.DNA.behavior.target = -1.0;  // DNA 직접 변경 (영구적)
  cell.DNA.color.h = 120;           // DNA 직접 변경
  cell.DNA.shape.w1.ω *= 0.6;       // DNA 직접 변경
}
```

### 요약

|구분|세균 접촉|바이러스 감염|
|---|---|---|
|**영향 대상**|임시 상태 (tempState)|DNA (영구)|
|**지속 시간**|일시적 (회복 가능)|영구적 (변이)|
|**변경 내용**|형태/움직임만|세포 성질 자체|
|**시각적 효과**|일시적 왜곡 → 복구|색상/형태 완전 변화|

---

## 아메바 형태 오브젝트 수학적 설계

### 권장 방식: 극좌표 변조 + 노이즈 (하이브리드)

#### 기본 수식

```
r(θ, t) = baseRadius 
        + A₁ · sin(n₁·θ + ω₁·t)     // 기본 타원 변형
        + A₂ · sin(n₂·θ + ω₂·t)     // 중간 돌기
        + A₃ · sin(n₃·θ + ω₃·t)     // 미세 돌기
        + A_noise · noise(θ, t)      // 불규칙성 (선택)

color = lerp(baseColor, activeColor, activationLevel)
```

#### 파라미터 설명

- `baseRadius`: 기본 반지름
- `Aᵢ`: 각 주파수 성분의 진폭 (변형 크기)
- `nᵢ`: 각도 주파수 (돌기 개수 결정: n=2는 타원, n=3은 3개 돌기)
- `ωᵢ`: 시간 주파수 (변형 속도)
- `t`: 시간
- `θ`: 각도 (0 ~ 2π)
- `baseColor`: 비활성 상태 색상 (밝은 톤)
- `activeColor`: 활성 상태 색상 (어두운 톤)
- `activationLevel`: 활성화 정도 (0~1, 적 접촉/공격 시 증가)

---

## 방식별 비교

|방식|수식 복잡도|계산 비용|자연스러움|제어 용이성|
|---|---|---|---|---|
|메타볼|낮음|높음|★★★★|★★☆|
|극좌표 변조|중간|낮음|★★★☆|★★★★|
|노이즈 기반|낮음|중간|★★★★★|★★☆|
|**하이브리드**|**중간**|**중간**|**★★★★★**|**★★★★**|

---

## 백혈구 종류별 파라미터 세트

### 1. 호중구 (Neutrophil) - 60-70% 🪖 보병

**역할**: 세균 전문, 최전선 돌격, 감염 현장 최초 도착

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|8-12|중간 크기|
|`n₁, n₂, n₃`|4, 6, 8|각진 외형 (높은 주파수)|
|`A₁, A₂, A₃`|0.3, 0.2, 0.1|중간 진폭 (적극적 변형)|
|`ω₁, ω₂, ω₃`|2.5, 3.0, 3.5|빠른 변형 (공격적)|
|**색상**|`#E8B4D4` → `#D47BA8`|연한 분홍 → 진한 분홍 (활성화 시)|
|**특수 효과**|접촉 시 급격한 변형||

---

### 2. 림프구 (Lymphocyte) - 20-30%

#### 2-1. T세포 (T-cell) ⚔️ 특수부대/지휘관

**역할**: 바이러스 감염 세포 파괴, 면역 반응 지휘

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|6-8|작은 크기|
|`n₁, n₂, n₃`|3, 5, 7|날카로운 변형|
|`A₁, A₂, A₃`|0.25, 0.15, 0.1|작은 진폭 (정밀함)|
|`ω₁, ω₂, ω₃`|3.5, 4.0, 4.5|매우 빠른 변형 (민첩)|
|**색상**|`#A8D5E2` → `#4A90A4`|하늘색 → 청록색 (활성화 시)|
|**특수 효과**|표적 탐지 시 돌기 신장||

#### 2-2. B세포 (B-cell) 🏭 미사일 기지

**역할**: 항체 생산 공장

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|7-9|작은 크기|
|`n₁, n₂, n₃`|2, 3, 4|부드러운 외형|
|`A₁, A₂, A₃`|0.2, 0.15, 0.1|작은 진폭 (안정적)|
|`ω₁, ω₂, ω₃`|1.0, 1.5, 2.0|느린 변형 (생산 집중)|
|**색상**|`#B8C5E8` → `#7E8FD4`|연보라 → 진보라 (항체 생산 시)|
|**특수 효과**|주기적으로 작은 입자(항체) 방출||

#### 2-3. NK세포 (Natural Killer) 🗡️ 암살자

**역할**: 암세포/바이러스 감염 세포 즉시 공격

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|7-10|중소형|
|`n₁, n₂, n₃`|5, 7, 9|매우 각진 외형|
|`A₁, A₂, A₃`|0.35, 0.25, 0.15|큰 진폭 (공격적)|
|`ω₁, ω₂, ω₃`|4.0, 5.0, 6.0|가장 빠른 변형|
|**색상**|`#C8A8D8` → `#8B5A9F`|연보라 → 진보라 (공격 시 어두워짐)|
|**특수 효과**|표적 근접 시 돌기 폭발적 신장||

---

### 3. 단핵구/대식세포 (Monocyte/Macrophage) - 5-10% 🧹 청소부+정찰병

**역할**: 잔해 제거, 정보 수집 및 전달

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|12-18|큰 크기|
|`n₁, n₂, n₃`|2, 3, 5|부드러운 외형|
|`A₁, A₂, A₃`|0.5, 0.3, 0.2|매우 큰 진폭 (유연함)|
|`ω₁, ω₂, ω₃`|0.8, 1.2, 1.5|느린 변형 (느긋함)|
|**색상**|`#C8E8C8` → `#7FBF7F`|연두색 → 초록색 (포식 시)|
|**특수 효과**|잔해 접촉 시 일부 흡수하며 커짐||

---

### 4. 호산구 (Eosinophil) - 1-4% 🪱 기생충 전문

**역할**: 기생충 공격, 알레르기 반응

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|9-11|중간 크기|
|`n₁, n₂, n₃`|4, 6, 8|중간 각진 형태|
|`A₁, A₂, A₃`|0.25, 0.2, 0.15|중간 진폭|
|`ω₁, ω₂, ω₃`|1.8, 2.2, 2.5|중간 속도|
|**색상**|`#F8D8A8` → `#E8A858`|연주황 → 주황색 (활성화 시)|
|**특수 효과**|이중 핵 표현 (내부 2개 점)||

---

### 5. 호염기구 (Basophil) - <1% 💥 히스타민 폭탄

**역할**: 알레르기/염증 반응, 히스타민 방출

|파라미터|값|설명|
|---|---|---|
|`baseRadius`|8-10|작은 크기|
|`n₁, n₂, n₃`|3, 5, 7|불규칙한 외형|
|`A₁, A₂, A₃`|0.3, 0.25, 0.2|중간 진폭|
|`ω₁, ω₂, ω₃`|2.0, 2.5, 3.0|중간-빠름|
|**색상**|`#A8A8D8` → `#6868B8`|연보라 → 진보라 (방출 시)|
|**특수 효과**|자극 시 작은 입자(히스타민) 폭발적 방출||

---

## 색상 시스템 정리

### 기본 색상 팔레트

```
호중구:   분홍계 (#E8B4D4 → #D47BA8)
T세포:    청록계 (#A8D5E2 → #4A90A4)
B세포:    보라계 (#B8C5E8 → #7E8FD4)
NK세포:   진보라계 (#C8A8D8 → #8B5A9F)
대식세포: 초록계 (#C8E8C8 → #7FBF7F)
호산구:   주황계 (#F8D8A8 → #E8A858)
호염기구: 청보라계 (#A8A8D8 → #6868B8)
```

### 색상 변화 트리거

- **비활성 → 활성**: 밝은 색 → 어두운 색
- **포식/공격**: 채도 증가
- **사망**: 투명도 증가 + 회색화

---

## 구현 고려사항

### 성능 최적화

- **SVG path 렌더링**: 수백 개체 가능, 벡터 기반으로 확대/축소 자유로움
- **Canvas 2D**: 더 빠르지만 수천 개는 어려움

### 움직임 패턴

- **위치 이동**: 베지어 곡선 또는 sin/cos 조합
- **변형 애니메이션**: 각 파라미터(Aᵢ, ωᵢ)에 독립적인 시간 함수 적용

---

---

## 접촉 반응 시스템 (백혈구 ↔ 세균)

### 핵심 원리: DNA는 변경 안 함, 임시 상태만 변경

**중요**: 세균 접촉은 **DNA를 변경하지 않음**. 함수 계산에 사용되는 **임시 상태값**만 변경.

#### 데이터 구조

```javascript
// DNA - 세포의 본질 (바이러스만 변경 가능)
const DNA = {
  shape: { base: 10, w1: { A: 0.3, n: 4, ω: 2.5 }, ... }
};

// 임시 상태 - 세균 접촉으로 변하는 값 (일시적)
const tempState = {
  interference: 0,        // 간섭 강도 (0 ~ 1)
  damping: 1.0,          // 감쇠 계수 (1.0 → 0)
  phaseShock: [0, 0, 0], // 위상 충격 (각 wave별)
  contactTime: null      // 접촉 시각
};
```

---

### 렌더링 함수 (DNA + 임시 상태 조합)

#### 접촉 전 (정상 상태)

```javascript
r(θ, t) = DNA.shape.base 
        + DNA.shape.w1.A × sin(DNA.shape.w1.n × θ + DNA.shape.w1.ω × t)
        + DNA.shape.w2.A × sin(DNA.shape.w2.n × θ + DNA.shape.w2.ω × t)
        + DNA.shape.w3.A × sin(DNA.shape.w3.n × θ + DNA.shape.w3.ω × t)
```

#### 접촉 후 (임시 상태 반영)

```javascript
// Δt = 접촉 후 경과 시간
Δt = t - tempState.contactTime

r(θ, t) = DNA.shape.base 
        + [DNA.shape.w1.A × (1 - tempState.interference)] 
          × sin(DNA.shape.w1.n × θ + DNA.shape.w1.ω × t + tempState.phaseShock[0])
          × tempState.damping
        + [DNA.shape.w2.A × (1 - tempState.interference)]
          × sin(DNA.shape.w2.n × θ + DNA.shape.w2.ω × t + tempState.phaseShock[1])
          × tempState.damping
        + [DNA.shape.w3.A × (1 - tempState.interference)]
          × sin(DNA.shape.w3.n × θ + DNA.shape.w3.ω × t + tempState.phaseShock[2])
          × tempState.damping

여기서:
- DNA 값은 그대로 (변경 없음)
- tempState 값만 변경됨
- 시간 지나면 tempState가 초기값으로 복귀
```

---

### 세균 접촉 시 동작

```javascript
// 세균과 접촉 순간
function onBacteriaContact(cell) {
  // DNA는 건드리지 않음!
  
  // 임시 상태만 변경
  cell.tempState.interference = cell.DNA.behavior.contact;  // DNA에서 읽기만
  cell.tempState.damping = 1.0;  // 초기값
  cell.tempState.contactTime = currentTime;
  
  // 10% 확률로 위상 충격
  if (Math.random() < 0.1) {
    cell.tempState.phaseShock = [
      random(π/3, 2π/3),
      random(π/4, π/2),
      random(0, π/4)
    ];
  }
}

// 매 프레임 업데이트
function updateTempState(cell, t) {
  if (cell.tempState.contactTime === null) return;  // 접촉 없음
  
  const Δt = t - cell.tempState.contactTime;
  const γ = cell.DNA.meta.recovery;  // DNA에서 회복 속도 읽기
  
  // 감쇠 계산 (룩업 테이블 사용)
  cell.tempState.damping = dampingTable[Math.floor(Δt * 10)];
  
  // 위상 충격 감소
  cell.tempState.phaseShock = cell.tempState.phaseShock.map(
    φ => φ × Math.exp(-2 × Δt)
  );
  
  // 완전 회복 시 초기화
  if (Δt > 10) {  // 충분한 시간 경과
    cell.tempState = { interference: 0, damping: 1.0, phaseShock: [0,0,0], contactTime: null };
  }
}
```

---

### 성능 최적화 버전 ⚡

**문제**: 수백 개 오브젝트가 각각 `e^(-γ × Δt)` 계산하면 부담

**해결책**: 사전 계산 + 룩업 테이블

```javascript
// 초기화 시 1회만 계산
const dampingTable = [];
for (let i = 0; i <= 100; i++) {
  dampingTable[i] = Math.exp(-0.3 * i * 0.1);  // 0.1초 단위
}

// 실행 시
const index = Math.floor(Δt * 10);  // Δt를 인덱스로 변환
const D = dampingTable[index];  // 룩업 (단순 배열 접근)
```

**계산량**:

- 접촉 전: `sin()` 3회
- 접촉 후: `sin()` 3회 + 곱셈 9회 + 배열 접근 1회
- **증가량**: 거의 무시 가능

---

### 세포별 반응 파라미터 (DNA에 저장)

세균 접촉 시 사용되는 파라미터는 **DNA에 읽기 전용**으로 저장:

|세포 타입|DNA.behavior.contact|DNA.meta.recovery|회복 시간|비고|
|---|---|---|---|---|
|**호중구**|0.35|0.6|~3초|빠른 회복 (전투병)|
|**T세포**|0.30|0.7|~2.5초|매우 빠른 회복 (특수부대)|
|**NK세포**|0.40|0.8|~2초|순간 충격 후 급속 회복|
|**대식세포**|0.25|0.3|~6초|느린 회복 (여유 있음)|
|**B세포**|0.20|0.4|~5초|약한 충격 (비전투)|
|**호산구**|0.30|0.5|~4초|중간|
|**호염기구**|0.35|0.5|~4초|중간|

---

### 특수 이벤트: 위상 충격 (Phase Shock) 💥

**발동 조건**: 접촉 시 10% 확률 (랜덤)

**효과**: 갑작스런 형태 왜곡 → 서서히 정상화

#### 수식

```
접촉 순간에 tempState.phaseShock에 랜덤 값 저장:

tempState.phaseShock[0] = random(π/3, 2π/3)  // 60° ~ 120°
tempState.phaseShock[1] = random(π/4, π/2)
tempState.phaseShock[2] = random(0, π/4)

시간에 따라 감소:
φᵢ(Δt) = φ_initialᵢ × e^(-2·Δt)  // 위상도 점점 0으로 복귀
```

**시각적 효과**:

- 0.0초: 갑자기 일그러짐 (위상 뒤틀림)
- 0.5초: 형태가 "떨리며" 복구
- 1.0초: 거의 정상화

**성능 영향**:

- 10%만 발동 → 전체 계산량 +1% 미만
- 위상값도 룩업 테이블 사용 가능

---

### 시각적 피드백

접촉 시 추가 효과 (모두 임시 상태):

1. **색상 변화**: `activationLevel` 즉시 증가 (임시)
    
    ```
    activationLevel = min(1.0, current + 0.3)
    color = lerp(DNA.color.baseColor, DNA.color.activeColor, activationLevel)
    ```
    
2. **크기 변화**: 세균 흡수 → 일시적 팽창 (임시)
    
    ```
    renderRadius = DNA.shape.base × (1 + 0.1 × tempState.damping)
    ```
    
    - 접촉 직후: 10% 커짐
    - 시간 지남: 원래대로
3. **세균 소멸 애니메이션**:
    
    ```
    bacteriaOpacity = 1 - min(1, Δt / 0.5)  // 0.5초에 걸쳐 사라짐
    bacteriaScale = 1 - Δt / 0.5
    ```
    

---

---

## 바이러스 감염 시스템

### DNA 구조 설계

**DNA = 세포의 형태/행동을 결정하는 파라미터 세트**

```javascript
DNA = {
  // 형태 유전자 (함수 파라미터 직접 연결)
  shape: {
    base: 10,                    // baseRadius
    w1: { A: 0.3, n: 4, ω: 2.5 },  // wave 1
    w2: { A: 0.2, n: 6, ω: 3.0 },  // wave 2  
    w3: { A: 0.1, n: 8, ω: 3.5 }   // wave 3
  },
  
  // 색상 유전자
  color: {
    h: 200,    // Hue (0-360)
    s: 60,     // Saturation (0-100)
    l: 70      // Lightness (0-100)
  },
  
  // 행동 유전자
  behavior: {
    target: 1.0,      // 1=적, 0=무관심, -1=아군
    speed: 1.0,       // 이동 속도 배율
    contact: 0.35     // 접촉 시 I 값
  },
  
  // 대사 유전자
  meta: {
    recovery: 0.6,    // γ 값 (회복 속도)
    divide: 0.0       // 분열 확률 (0~1)
  }
}
```

### DNA 시각화 (유저 인식)

**16진수 코드로 압축 표현**

```
DNA 코드: #A34C-5F2E-81B0-0960

해석:
A34C = shape 정보 (4자리)
5F2E = color 정보 (4자리)
81B0 = behavior 정보 (4자리)
0960 = meta 정보 (4자리)
```

**UI 표시 예시:**

- 세포 위에 작은 텍스트: `#A34C`
- 마우스 오버 시 전체: `#A34C-5F2E-81B0-0960`
- 색상 바 형태로도 가능 (16비트 = 16개 작은 색상 블록)

---

## 바이러스 변이 시나리오 (총 6종)

### 1. 좀비화 (Zombie) 🧟

**효과**: 아군 공격

```javascript
mutation_zombie(dna) {
  dna.behavior.target = -1.0;          // 아군 공격
  dna.color.h = 120;                   // 녹색
  dna.color.s = 40;                    // 채도 낮춤 (탁함)
  dna.shape.w1.ω *= 0.6;               // 느려진 움직임
  dna.shape.w2.ω *= 0.6;
}
```

**시각적 변화**: 녹색 + 느린 떨림

---

### 2. 암세포화 (Cancer) 🦠

**효과**: 무한 증식

```javascript
mutation_cancer(dna) {
  dna.meta.divide = 0.3;               // 30% 분열 확률
  dna.shape.base *= 1.4;               // 비대화
  dna.behavior.contact = 0.1;          // 에너지 소모 감소
  dna.color.l = 40;                    // 어두워짐
  dna.shape.w1.A *= 1.3;               // 돌기 커짐
}
```

**시각적 변화**: 크고 어둡고 돌기 많음

---

### 3. 형태 붕괴 (Corruption) 💥

**효과**: 비정상적 형태

```javascript
mutation_corruption(dna) {
  dna.shape.w1.A *= -0.8;              // 진폭 반전
  dna.shape.w2.n = 13;                 // 기괴한 주파수
  dna.shape.w3.n = 7;
  dna.color.h = 0;                     // 빨강
  dna.color.s = 80;
  dna.behavior.speed *= 1.3;           // 빠른 움직임
}
```

**시각적 변화**: 빨강 + 뒤틀린 형태 + 빠름

---

### 4. 과민화 (Hyperactive) ⚡

**효과**: 과도한 반응, 빠른 소진

```javascript
mutation_hyperactive(dna) {
  dna.shape.w1.ω *= 3.0;               // 매우 빠른 진동
  dna.shape.w2.ω *= 3.0;
  dna.shape.w3.ω *= 3.0;
  dna.behavior.contact = 0.7;          // 접촉 시 큰 충격
  dna.meta.recovery = 0.2;             // 느린 회복
  dna.color.h = 45;                    // 주황
  dna.color.s = 90;
}
```

**시각적 변화**: 주황 + 격렬한 떨림

---

### 5. 마비화 (Paralysis) 🧊

**효과**: 움직임 정지

```javascript
mutation_paralysis(dna) {
  dna.shape.w1.ω = 0.1;                // 거의 멈춤
  dna.shape.w2.ω = 0.2;
  dna.shape.w3.ω = 0.1;
  dna.behavior.speed = 0.1;            // 이동 거의 불가
  dna.color.h = 210;                   // 청색
  dna.color.l = 80;                    // 밝은 청색 (얼어붙음)
  dna.shape.w1.A *= 0.3;               // 작은 변형
}
```

**시각적 변화**: 밝은 파랑 + 거의 정지

---

### 6. 카오스화 (Chaos) 🌀

**효과**: 예측 불가능한 행동

```javascript
mutation_chaos(dna) {
  dna.shape.w1.n = random(2, 15);      // 랜덤 주파수
  dna.shape.w2.n = random(2, 15);
  dna.shape.w3.n = random(2, 15);
  dna.shape.w1.ω = random(0.5, 5.0);   // 랜덤 속도
  dna.behavior.target = random(-1, 1); // 랜덤 대상
  dna.color.h = random(0, 360);        // 랜덤 색상
  dna.color.s = random(50, 100);
}
```

**시각적 변화**: 매번 다른 형태/색상/움직임

---

## 변이 시각화 비교표

|변이 타입|색상|크기|속도|형태 특징|
|---|---|---|---|---|
|**정상**|청록|1.0x|1.0x|부드러운 변형|
|**좀비**|녹색(탁함)|1.0x|0.6x|느린 떨림|
|**암세포**|어두움|1.4x|1.0x|큰 돌기|
|**붕괴**|빨강|1.0x|1.3x|뒤틀린 형태|
|**과민**|주황|1.0x|1.0x|격렬한 진동|
|**마비**|밝은 파랑|1.0x|0.1x|거의 정지|
|**카오스**|랜덤|랜덤|랜덤|예측 불가|

---

## 게임플레이 흐름

### 1. B세포 단계

```
정상 B세포 (#A34C-5F2E-81B0-0960)
    ↓
바이러스 침투 💉
    ↓
변이 B세포 (#A34C-FF00-C1B0-0960)  ← DNA 코드 변경
         ↑____________색상 유전자 변경
```

### 2. T세포 생산

```
변이 B세포
    ↓ (분열)
변이 T세포 생산 (동일 DNA 복사)
    ↓
녹색 좀비 T세포들이 아군 공격 시작
```

### 3. 플레이어 대응

- 변이 세포 발견 (육안: 색상/움직임 이상)
- DNA 코드 확인 (마우스 오버)
- 변이 B세포 우선 제거 (더 이상의 변이 T세포 생산 차단)
- 이미 생산된 변이 T세포 처리

---

## 구현 시 계산 연결

### 형태 계산에 DNA 직접 반영

```javascript
function calculateShape(dna, θ, t) {
  return dna.shape.base 
    + dna.shape.w1.A * Math.sin(dna.shape.w1.n * θ + dna.shape.w1.ω * t)
    + dna.shape.w2.A * Math.sin(dna.shape.w2.n * θ + dna.shape.w2.ω * t)
    + dna.shape.w3.A * Math.sin(dna.shape.w3.n * θ + dna.shape.w3.ω * t);
}

function getColor(dna, activationLevel) {
  const h = dna.color.h;
  const s = dna.color.s + activationLevel * 20;  // 활성화 시 채도 증가
  const l = dna.color.l - activationLevel * 20;  // 활성화 시 어두워짐
  return hslToRgb(h, s, l);
}
```

### 행동 계산에 DNA 반영

```javascript
function updateMovement(cell, targetCells) {
  // 대상 필터링
  const targets = targetCells.filter(t => {
    if (cell.dna.behavior.target > 0) return t.isEnemy;
    if (cell.dna.behavior.target < 0) return t.isFriend;  // 좀비화
    return false;  // 무관심
  });
  
  // 속도 적용
  cell.velocity *= cell.dna.behavior.speed;
}
```

---

## 다음 단계

- [ ] 프로토타입 코드 작성
- [ ] 각 세포 타입별 파라미터 세트 정의
- [x] 인터렉션 메커니즘 설계
- [ ] 룩업 테이블 최적화 구현
- [ ] 다수 오브젝트 성능 테스트
- [x] 바이러스 변이 시스템 설계
- [ ] DNA 시각화 UI 구현
- [x] 장면 전환 시스템 설계
- [x] 백혈구 vs 세균 전투 시스템 설계
- [ ] 장면 2 미니게임 설계 (바이러스 vs DNA)

---

## 백혈구 vs 세균 전투 시스템 ⚔️

### 핵심 메커니즘

```
세균 접촉 → 백혈구 약화 (누적)
         ↓
    회복력 < 약화 속도  →  소멸 + 고름 생성
    회복력 > 약화 속도  →  승리 (세균 제거)
```

**중요**:

- 세균은 DNA를 변경하지 않음
- 백혈구는 지속 회복력이 있어 결국 세균을 이김
- 회복력이 따라가지 못하면 소멸

---

### 약화 시스템 (Weakening)

#### 데이터 구조

```javascript
// 백혈구 상태 (DNA와 별개)
cell.condition = {
  weakness: 0.0,        // 약화 수치 (0 ~ 1)
  contactCount: 0,      // 누적 접촉 횟수
  isAlive: true
};

// 매 프레임 업데이트
function updateWeakness(cell, dt) {
  // 세균과 접촉 중이면 약화 증가
  if (cell.isContactingBacteria) {
    cell.condition.weakness += WEAKEN_RATE × dt;
  }
  
  // 자동 회복 (DNA.meta.recovery 사용)
  cell.condition.weakness -= cell.DNA.meta.recovery × dt;
  
  // 범위 제한
  cell.condition.weakness = clamp(cell.condition.weakness, 0, 1);
  
  // 완전 약화 시 소멸
  if (cell.condition.weakness >= 1.0) {
    cell.condition.isAlive = false;
    createPus(cell.position);  // 고름 생성
  }
}
```

---

### 약화 효과 (3가지 시각적 변화)

#### 1. 크기 감소

```javascript
renderRadius = DNA.shape.base × (1 - 0.5 × weakness)

예시:
weakness = 0.0 → 100% 크기 (정상)
weakness = 0.5 → 75% 크기 (약화됨)
weakness = 1.0 → 50% 크기 (소멸 직전)
```

#### 2. 색상 탈색 (회색화)

```javascript
// 채도 감소 + 밝기 감소
s = DNA.color.s × (1 - 0.6 × weakness)
l = DNA.color.l × (1 - 0.3 × weakness)

예시:
weakness = 0.0 → 선명한 색
weakness = 0.5 → 탁한 색
weakness = 1.0 → 거의 회색
```

#### 3. 운동성 저하

```javascript
// 이동 속도 감소
moveSpeed = DNA.behavior.speed × (1 - 0.7 × weakness)

// 변형 속도 감소 (떨림 약화)
ω₁' = DNA.shape.w1.ω × (1 - 0.5 × weakness)
ω₂' = DNA.shape.w2.ω × (1 - 0.5 × weakness)
ω₃' = DNA.shape.w3.ω × (1 - 0.5 × weakness)

예시:
weakness = 0.0 → 활발한 움직임
weakness = 0.5 → 느린 움직임
weakness = 1.0 → 거의 정지
```

---

### 고름 (Pus) 시스템 🟡

#### 고름 생성 조건

1. 백혈구 소멸 시 (`weakness >= 1.0`)
2. 세균 제거 성공 시 일부 호중구 사망 (확률적)

#### 고름 오브젝트

```javascript
pus = {
  position: { x, y },
  size: 5 ~ 15,           // 크기 (랜덤)
  opacity: 1.0,           // 투명도
  color: "#E8E8C8",       // 연한 노란색/회색
  settled: false,         // 침전 여부
  fallSpeed: 0.5          // 낙하 속도 (중력)
};

// 물리 (중력)
pus.position.y += pus.fallSpeed × dt;

// 바닥 도달 시
if (pus.position.y >= FLOOR_Y) {
  pus.settled = true;
  pus.fallSpeed = 0;
  pus.shape = "ellipse";  // 둥근 형태 → 타원으로 변형 (퍼짐)
}
```

#### 고름 라이프사이클

```
[생성] 둥근 입자, 불투명
   ↓
[낙하] 중력으로 아래로 떨어짐
   ↓
[침전] 바닥 도달, 타원형으로 퍼짐
   ↓
[대기] 대식세포 청소 대기
   ↓
[흡수] 대식세포 접촉 시 페이드아웃
   ↓
[소멸] 완전히 사라짐
```

---

### 청소 세포 (대식세포 역할 확장) 🧹

#### 대식세포 DNA에 청소 기능 추가

```javascript
// 대식세포 전용 파라미터
DNA.behavior.cleanup = true;  // 다른 세포는 false
DNA.behavior.cleanupRange = 50;  // 고름 탐지 거리
```

#### 행동 로직

```javascript
function macrophageBehavior(cell) {
  // 1순위: 침전된 고름 찾기
  const nearestPus = findNearestPus(cell.position, cell.DNA.behavior.cleanupRange);
  
  if (nearestPus && nearestPus.settled) {
    moveToward(nearestPus);
    
    // 접촉 시 흡수
    if (distance(cell, nearestPus) < cell.radius) {
      absorbPus(nearestPus);
      cell.size += 0.1;  // 살짝 커짐 (시각적 피드백)
    }
  } 
  // 2순위: 세균 잔해 처리
  else {
    // 기존 대식세포 행동 (느린 이동, 세균 탐색)
  }
}

function absorbPus(pus) {
  // 페이드아웃 애니메이션 (0.5초)
  pus.opacity -= 2.0 × dt;
  
  if (pus.opacity <= 0) {
    remove(pus);
  }
}
```

---

### 전투 결과 시나리오

#### 시나리오 1: 백혈구 승리 ✅

```
호중구 (recovery: 0.6) vs 세균 1개
  ↓
접촉 시작: weakness 증가 (0.2/초)
회복: weakness 감소 (0.6/초)
  ↓ (약 3초 경과)
세균 제거 성공
  ↓
호중구 소멸 (50% 확률) → 고름 생성
  or
호중구 생존 (50% 확률) → weakness 0으로 자연 회복
```

#### 시나리오 2: 백혈구 소멸 ❌

```
B세포 (recovery: 0.4) vs 세균 3개 동시
  ↓
접촉 시작: weakness 급증 (0.6/초)
회복: weakness 감소 (0.4/초)
  ↓ (약 5초 경과)
weakness = 1.0 도달
  ↓
B세포 소멸 → 고름 생성
세균 3개는 살아남음 (다른 백혈구가 처리)
```

#### 시나리오 3: 대식세포 청소 🧹

```
전투 종료 후 바닥에 고름 10개 침전
  ↓
대식세포가 고름 탐지 (범위 50)
  ↓
가장 가까운 고름으로 이동
  ↓
접촉 시 흡수 (1개당 0.5초)
  ↓
대식세포 크기 증가 (시각적 피드백)
  ↓
다음 고름으로 이동 (반복)
  ↓
깨끗한 전장
```

---

### 세포별 전투 특성

|세포 타입|DNA.meta.recovery|전투 스타일|승리 후 소멸 확률|비고|
|---|---|---|---|---|
|**호중구**|0.6|1:1 전투 특화|50%|전투병, 균형잡힌 회복력|
|**T세포**|0.7|빠른 회복|20%|특수부대, 생존률 높음|
|**NK세포**|0.8|순간 폭발|10%|암살자, 거의 살아남음|
|**대식세포**|0.3|청소 중심|80%|느리지만 청소 역할|
|**B세포**|0.4|비전투|90%|항체 생산, 전투 약함|
|**호산구**|0.5|중간|60%|기생충 전문|
|**호염기구**|0.5|중간|60%|히스타민 방출|

---

### 약화 상태 시각화 가이드

```
weakness = 0.0 ~ 0.2  [정상]
- 크기: 100%
- 색상: 선명
- 움직임: 활발
- 상태: 건강

weakness = 0.3 ~ 0.6  [약화]
- 크기: 85%
- 색상: 약간 탁함
- 움직임: 느려짐
- 상태: 피곤

weakness = 0.7 ~ 0.9  [위험]
- 크기: 65%
- 색상: 회색화
- 움직임: 거의 정지
- 상태: 빈사

weakness = 1.0  [소멸]
- 고름으로 변환
- 바닥으로 낙하
```

---

## 장면 전환 시스템 🎥

### 2개의 장면 구조

#### 장면 1: 혈관 속 (매크로 뷰)

- **스케일**: 다수의 백혈구/세균 (세포 크기 10-20px)
- **인터렉션**: 백혈구 ↔ 세균 접촉 전투
- **시점**: 넓은 시야, 전체 전장 조망

#### 장면 2: 세포 속 (마이크로 뷰)

- **스케일**: 1개 세포 내부 확대 (DNA 크기 100px+)
- **인터렉션**: 바이러스 ↔ DNA 편집 시도/방어
- **시점**: 세포 내부, DNA 구조 상세 표현

---

### 장면 전환 흐름

```
[장면 1: 혈관 속] 🔬
  백혈구들이 세균과 전투 중...
  ↓
  💉 바이러스 침투 이벤트 발생!
  ↓
[줌인 애니메이션] 🎥
  특정 B세포 1개가 화면 가득 확대
  배경 흐릿하게 + 시간 정지
  ↓
[장면 2: 세포 속] 🧬
  바이러스가 DNA 편집 시도
  플레이어 방어 (미니게임)
  ↓
[결과 판정]
  - 성공: DNA 보호 (정상 상태 유지)
  - 실패: DNA 변이 (변이 타입 적용)
  - 부분 성공: 일부 유전자만 보호
  ↓
[줌아웃 애니메이션] 🎥
  ↓
[장면 1: 혈관 속] 🔬
  결과가 모든 B세포에 동일 적용
  (실패 시 → 변이된 B세포들이 변이 T세포 생산 시작)
```

---

### 데이터 전달 구조

#### 장면 1 → 장면 2

```javascript
transitionData = {
  targetCell: B세포_참조,
  cellDNA: "#A34C-5F2E-81B0-0960",  // 현재 DNA
  virusType: "zombie" | "cancer" | "corruption" | ...,
  threatLevel: 1~5  // 미니게임 난이도
}
```

#### 장면 2 → 장면 1

```javascript
gameResult = {
  success: true | false,
  mutationType: null | "zombie" | "cancer" | ...,
  protectionRate: 0.0 ~ 1.0,  // 부분 성공도
  newDNA: "#A34C-5F2E-81B0-0960"  // 변이된 DNA (실패 시)
}

// 장면 1 복귀 시
if (!gameResult.success) {
  scene1.applyMutationToAllBCells(gameResult.mutationType);
}
```

---

### 유기적 연결 원칙

1. **DNA 일관성**: 장면 2에서 보는 DNA = 장면 1의 B세포 DNA (동일 객체)
2. **전체 적용**: 장면 2의 결과는 장면 1의 모든 B세포에 동일 적용
3. **시간 흐름**: 장면 2 진행 중 장면 1은 일시정지 (집중도 향상)
4. **시각적 연속성**: 줌인/줌아웃 애니메이션으로 자연스러운 전환

---

### 복수 침투 처리

여러 바이러스가 동시에 침투할 경우:

```javascript
virusQueue = [
  { cellId: 1, virusType: "zombie" },
  { cellId: 3, virusType: "cancer" },
  { cellId: 5, virusType: "corruption" }
];

// 하나씩 순차 처리
while (virusQueue.length > 0) {
  const event = virusQueue.shift();
  transitionToScene2(event);
  // 미니게임 완료 후 다음 이벤트
}
```

---

### 장면별 렌더링 차이

|요소|장면 1 (혈관 속)|장면 2 (세포 속)|
|---|---|---|
|**배경**|혈관 벽 텍스처|세포질, 소기관들|
|**주요 오브젝트**|백혈구, 세균, 바이러스|DNA 나선, 바이러스, 방어 요소|
|**오브젝트 크기**|10-20px|100px+|
|**카메라**|고정/팬|확대/고정|
|**인터렉션**|자동 시뮬레이션|유저 입력 필요|

---

## 미완성 섹션 (다음 세션에서 설계)

### 장면 2: 바이러스 vs DNA 미니게임 ⚠️ TODO

- [ ] 바이러스의 DNA 편집 시도 방식
- [ ] 플레이어의 방어 메커니즘
- [ ] 성공/실패 판정 기준
- [ ] 부분 성공 시스템 (일부 유전자만 보호)
- [ ] DNA 시각화 방법
- [ ] 타임 어택 vs 퍼즐 vs 액션?

### 장면 2: 바이러스 vs DNA 디펜스 미니게임 🎮

#### 게임 개요

- **장르**: 타워 디펜스 + 슈팅
- **목표**: DNA 변이를 1/3 미만으로 막기
- **실패**: DNA 변이 1/3 이상 → 변이 이벤트 발생

---

#### 게임 화면 구성

```
┌─────────────────────────────────────┐
│    [바이러스 군 스폰 지역]           │  ← 상단
│         ↓  ↓  ↓  ↓  ↓              │
│                                      │
│  [자동 포탑]    [장애물]   [자동 포탑] │
│                                      │
│ 🔫                            🔫    │  ← 좌우 유저 포탑
│ 유저                          유저  │     (대각선 발사)
│ 포탑                          포탑  │
│                                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  ← 하단
│  [DNA 정보 나열 + 방어막]          │
│  #A34C-5F2E-81B0-0960              │
└─────────────────────────────────────┘
```

---

#### DNA 구조 (하단 바닥)

##### DNA 시각화

javascript

```javascript
DNA = {
  segments: [
    { id: "shape_w1_A", value: 0.3, shield: 100, corrupted: false },
    { id: "shape_w1_n", value: 4, shield: 100, corrupted: false },
    { id: "color_h", value: 200, shield: 100, corrupted: false },
    { id: "behavior_target", value: 1.0, shield: 100, corrupted: false },
    // ... 총 10~15개 세그먼트
  ],
  totalSegments: 15,
  corruptedCount: 0  // 변이된 세그먼트 수
};
```

##### DNA 세그먼트 상태

```
[정상] shield: 100 → 파란색 발광
[손상] shield: 50  → 노란색 경고
[위험] shield: 10  → 빨간색 점멸
[변이] shield: 0   → 회색 + 바이러스 색상
```

---

#### 방어 요소

##### 1. 자동 방어 포탑 (세포 기본 장비)

javascript

```javascript
autoTurret = {
  position: { x, y },
  type: "antibody_cannon",  // 항체 발사
  fireRate: 2.0,  // 초당 2발
  damage: 10,
  range: 100,
  target: "nearest"  // 가장 가까운 바이러스
};
```

**포탑 종류**:

- 항체 캐논: 직선 발사
- 면역 레이저: 관통 공격
- 슬로우 필드: 범위 내 감속

##### 2. 경로 방해물 (배치형)

javascript

```javascript
obstacle = {
  type: "membrane_wall",  // 세포막 벽
  health: 50,
  position: { x, y },
  slowEffect: 0.5  // 50% 감속
};
```

**장애물 종류**:

- 세포막 벽: 내구도 높음
- 점액 트랩: 감속 + 데미지
- 미토콘드리아 실드: 에너지 방벽

##### 3. 유저 포탑 (좌우 양쪽)

javascript

```javascript
userTurret = {
  position: "left" | "right",
  angle: 45,  // 대각선 위 (고정)
  fireMode: "manual",  // 유저가 타이밍 결정
  damage: 15,
  cooldown: 0.5  // 초
};

// 조작
왼쪽 포탑: A 키 or 좌클릭
오른쪽 포탑: D 키 or 우클릭
```

---

#### 바이러스 공격 메커니즘

##### 바이러스 유닛

javascript

```javascript
virus = {
  position: { x, y },
  health: 20,
  speed: 30,
  targetSegment: randomDNA(),  // 목표 DNA 세그먼트
  corruptionPower: 10  // 부식력
};

// 이동
virus.position.y += virus.speed × dt;  // 아래로 하강

// DNA 도달 시
if (reached(virus, DNA)) {
  DNA.segments[virus.targetSegment].shield -= virus.corruptionPower;
  
  // 방어막 파괴 시
  if (DNA.segments[virus.targetSegment].shield <= 0) {
    corruptSegment(virus.targetSegment, virus.type);
  }
}
```

##### 바이러스 웨이브

```
Wave 1: 5개 (느림)
Wave 2: 10개 (중간)
Wave 3: 15개 (빠름)
Wave 4: 20개 (보스급 포함)
```

---

#### DNA 변이 시스템

##### 부식 과정

javascript

```javascript
function corruptSegment(segmentId, virusType) {
  const segment = DNA.segments[segmentId];
  
  // 변이 적용 (바이러스 타입별)
  switch(virusType) {
    case "zombie":
      if (segmentId === "behavior_target") {
        segment.value = -1.0;  // 아군 공격
      }
      break;
    case "cancer":
      if (segmentId === "meta_divide") {
        segment.value = 0.3;  // 무한 증식
      }
      break;
    // ...
  }
  
  segment.corrupted = true;
  DNA.corruptedCount++;
}
```

##### 변이 임계값

javascript

```javascript
mutationThreshold = DNA.totalSegments / 3;  // 1/3

if (DNA.corruptedCount >= mutationThreshold) {
  triggerMutationEvent();  // 게임 오버 (변이 발생)
}
```

**결과 판정**:

- `corruptedCount = 0`: 완벽 방어 ✅
- `corruptedCount < 5`: 부분 방어 ⚠️ (일부 유전자만 변이)
- `corruptedCount >= 5`: 실패 ❌ (전체 변이 적용)

---

#### 게임 흐름

```
1. 게임 시작
   - DNA 15개 세그먼트 표시
   - 자동 포탑 3개 배치
   - 유저 포탑 2개 대기
   
2. Wave 1 시작
   - 바이러스 5개 스폰
   - 유저 포탑 수동 발사
   - 자동 포탑 자동 공격
   
3. 바이러스 도달
   - DNA 방어막 부식
   - 세그먼트 1개 변이
   
4. Wave 2~4 반복
   
5. 결과 판정
   - 변이 세그먼트 < 5개: 성공
   - 변이 세그먼트 >= 5개: 실패
   
6. 장면 1 복귀
   - 결과 DNA 적용
   - 모든 B세포에 반영
```

---

#### 난이도 조절

**바이러스 타입 (threatLevel)**:

javascript

```javascript
threatLevel_1: {
  virusCount: 30,
  virusHealth: 20,
  virusSpeed: 30
}

threatLevel_3: {
  virusCount: 50,
  virusHealth: 40,
  virusSpeed: 50
}

threatLevel_5: {
  virusCount: 80,
  virusHealth: 60,
  virusSpeed: 70,
  bossVirus: true  // 보스급 포함
}
```

---

#### 시각적 요소

##### DNA 방어막 이펙트

- 정상: 파란색 실드 레이어
- 공격받음: 붉은 충격파
- 파괴: 크랙 → 파편 효과

##### 바이러스 비주얼

- 기본형: 작은 가시 구체
- 좀비 바이러스: 녹색 + 느림
- 암 바이러스: 검은색 + 큼
- 붕괴 바이러스: 빨강 + 빠름

##### 발사 이펙트

- 항체 캐논: 파란색 탄환
- 유저 포탑: 노란색 레이저
- 면역 레이저: 지속 빔

---

**다음 논의 필요**:

- [ ]  자동 포탑/장애물 업그레이드 시스템?
- [ ]  부분 성공 시 보상 (일부 DNA만 보호)?
- [ ]  보스 바이러스 패턴?

#### 추천 순위

##### 1위: **Phaser 3** (JavaScript) ⭐ 최적

```
장점:
✅ 2D 게임 전문 엔진
✅ 물리 엔진 내장 (Arcade Physics)
✅ 파티클 시스템 (고름, 발사 이펙트)
✅ 웹 브라우저 즉시 실행
✅ 무료 오픈소스
✅ 학습 곡선 완만
✅ 수백 개 오브젝트 처리 가능

단점:
⚠️ JavaScript 필요 (하지만 쉬움)

적합도: 95%
- 아메바 형태: Canvas 2D API로 가능
- 물리: 충돌 감지 자동
- 성능: WebGL 가속 지원
```

#### 프로젝트 구조 (Phaser 기준)

```
immune-simulation/
├── index.html
├── src/
│   ├── main.js              # 진입점
│   ├── scenes/
│   │   ├── Scene1_Blood.js  # 장면 1: 혈관 속
│   │   └── Scene2_Cell.js   # 장면 2: 세포 속
│   ├── objects/
│   │   ├── WhiteCell.js     # 백혈구 클래스
│   │   ├── Bacteria.js      # 세균
│   │   ├── Virus.js         # 바이러스
│   │   └── Pus.js           # 고름
│   ├── systems/
│   │   ├── DNASystem.js     # DNA 관리
│   │   └── CombatSystem.js  # 전투 로직
│   └── utils/
│       ├── DampingTable.js  # 룩업 테이블
│       └── ShapeFunction.js # 극좌표 함수
└── assets/
    └── ... (사운드, UI 등)
```