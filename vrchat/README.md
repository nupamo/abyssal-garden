# Abyssal Garden → VRChat 월드 포팅

웹 버전(`source/`)과 **같은 월드**를 VRChat(PC) 월드로 옮기는 작업 폴더입니다.
원본처럼 "작은 데이터 + 셰이더가 만들어내는" 구조를 목표로 합니다: **지형은 레이마칭**, 켈프·풀·바닥 덮개는 **배치 기록만 저장하고 잎 하나하나는 셰이더가 생성**, 바위 디테일 텍스처와 물결은 **로딩 때 GPU가 생성**. 다운로드 데이터는 압축 후 약 10 MB입니다 (메시로 구웠을 때 Medium 64 MB).
Unity 없이 할 수 있는 작업(데이터 익스포터, 셰이더·스크립트 포팅, 사운드 렌더링, 검증)은 끝냈고,
**Unity 쪽 코드(C#, HLSL)는 아직 한 번도 Unity에서 컴파일하거나 실행해 보지 않았습니다.** 집에서 처음 열 때 컴파일 에러를 몇 개 고쳐야 할 수 있습니다.

## 지금 상태

| | 상태 |
|---|---|
| 월드 생성 (지형, 켈프, 바위, 산호, 물고기…) | ✅ 웹 버전 생성 코드를 Node에서 그대로 실행 (`exporter/worldgen.mjs`) |
| 지형 레이마칭 | ✅ 지형 거리장(SDF)을 구워 레이마칭, 원본 WGSL 셰이딩으로 렌더해 확인 (`raymarch-preview-1.png`) |
| 식물 생성 (켈프, 풀, 바닥 덮개, 반짝이) | ✅ 원본 생성기의 배치 기록 + 해시로 잎 생성. 원본 잎과 비교: 종류별 개수·길이·폭·기울기·높이 평균 일치, 켈프 그림자 형태 일치 (`verify-grow.mjs`) |
| 지형 밀도장 (원본은 GPU 컴퓨트 셰이더) | ✅ CPU로 포팅, 원본 WGSL과 비교 검증: 오차 0.001 이하, 안/밖 판정 불일치 0 |
| 바위 디테일 텍스처 | ✅ CPU로 포팅, 원본 GPU 결과와 1/255 이내로 일치 |
| 태양 그림자 맵 | ✅ CPU 래스터라이저로 미리 구워 둠. 웹 버전이 실제로 그린 그림자 맵과 비교해서 텍셀 98.9% 일치, 깊이 차이 중앙값 7 mm |
| 사운드 | ✅ 원본 Web Audio 그래프를 오프라인 렌더링 → `Assets/AbyssalGarden/Audio/*.ogg` (커밋됨, 5 MB) |
| 셰이더 (HLSL) | ⚠️ 작성 완료, **Unity에서 컴파일 안 해 봄** |
| 에디터 임포터 (C#) | ⚠️ 작성 완료, **Unity에서 컴파일 안 해 봄** |
| UdonSharp 스크립트 (수영, 사운드, 인스턴스 테이블) | ⚠️ 작성 완료, **컴파일·테스트 안 해 봄** |
| Quest / Android | ❌ 대상 아님 (아래 "제약" 참고) |

## 집에서 할 일 (Unity)

### 1. 데이터 내보내기 (Node 18 이상, Unity 불필요)

```bash
cd vrchat/exporter
```

```bash
npm run export
```

- 약 1.5분, 출력 약 110 MB(압축 전, 대부분 반복 메시라 압축 후 약 10 MB) → `vrchat/Assets/AbyssalGarden/Raw~/` (git에는 안 올라감; Unity는 `~`로 끝나는 폴더를 무시합니다)
- 식물은 항상 원본 High 밀도로 기록됩니다. 레벨(`--level`, 기본 medium)은 실제로 그리는 비율(Medium = 잎 1/2, 대신 넓게), 그림자 맵 크기, 빛줄기 스텝 수만 정합니다. 머티리얼의 `_Thin`(1/2/4)으로 Unity에서도 바꿀 수 있어요.
- `Shaders/AbyssConfig.cginc`도 레벨에 맞게 다시 써집니다.
- 의존성 없이 Node 내장 모듈만 씁니다. (`npm install`은 검증 스크립트·사운드 렌더러용 Playwright가 필요할 때만)

### 2. Unity 프로젝트

1. VRChat Creator Companion(VCC)으로 새 **World** 프로젝트를 만듭니다 (Unity 2022.3, VRChat Worlds SDK, UdonSharp 포함).
2. `vrchat/Assets/AbyssalGarden` 폴더 통째로 프로젝트의 `Assets/` 아래로 복사합니다 (`Raw~` 포함). 심볼릭 링크도 됩니다.
3. Console에 셰이더/스크립트 컴파일 에러가 없는지 확인합니다. 에러가 나면 여기서 고칩니다.
4. 씬에 **VRCWorld** 프리팹을 넣습니다 (VRChat SDK 패키지 안에 있음).
5. 메뉴 **Abyssal Garden → Import World** 실행.
   - `Assets/AbyssalGarden/Generated/` 에 텍스처·메시·머티리얼을 만들고, 씬에 `Abyssal Garden` 오브젝트를 만듭니다 (다시 실행하면 교체).
   - VRCWorld의 스폰 지점(뷰포인트 1), Reference Camera, Respawn Height도 설정합니다.
   - UdonSharp 프로그램 에셋이 없으면 만들어 줍니다. 스크립트가 Missing으로 보이면 Import World를 한 번 더 실행하세요.
6. **Lighting 창**: Skybox Material 없음, Environment Lighting 검정, Fog 끔 (안개·조명은 전부 셰이더가 직접 합니다).
7. Play(ClientSim)로 확인 → VRChat SDK 패널에서 Build & Test.

씬을 다시 열면 씬 뷰에서 식물·바위가 안 보일 수 있습니다 (MaterialPropertyBlock은 저장되지 않음). **Abyssal Garden → Refresh Scene View Preview**를 누르면 돌아옵니다. 실제 월드에서는 `AbyssInstanceTable`이 시작할 때 설정합니다.

## 구조

### 좌표계
웹 버전은 오른손 좌표계, Unity는 왼손 좌표계입니다. Unity 좌표 = 웹 좌표에서 z 부호만 뒤집은 것 (`(x, y, -z)`), 보이는 모습은 같습니다.
지형 메시는 Unity 좌표로 내보내고(콜라이더로도 쓰려고), 나머지 인스턴스 데이터는 원래 좌표 그대로 두고 셰이더가 마지막에 z를 뒤집습니다 (`AbyssFlip`). 조명 계산은 전부 원래 좌표에서 해서 웹 셰이더를 거의 줄 단위로 옮길 수 있었습니다.

### 지형: 레이마칭
- `exporter/sdf.mjs`가 원본 밀도 격자(512×80×512, 0.75 m)에서 부호 있는 거리장을 굽습니다. 표면 근처 ±1.5 m는 원래 해상도 8비트, 그보다 먼 곳은 3 m 블록 단위의 "최소 이만큼은 떨어져 있다" 값으로 큰 걸음을 걷습니다.
- `AbyssRaymarch.shader`: 카메라를 감싼 구에서 화소마다 광선을 쏘아 지형/수면/배경을 찾고, 원본 바위 셰이딩(`AbyssSolid.cginc`의 `ShadeSolid`)으로 칠한 뒤 **깊이를 기록**합니다. 그래서 래스터라이즈되는 식물·바위·물고기가 지형과 정확히 겹칩니다.
- 충돌은 단순화: 바닥 높이맵(3 m 간격, 주변 12 m 중 가장 낮은 바닥을 매끈하게) MeshCollider 하나 + `AbyssSwim`의 수면·반경 150 m 제한. 중간 바위·메사는 통과됩니다.

### 식물: 배치 기록 + 셰이더 생성
- 원본 `world.js`를 그대로 실행하면서, 잎 묶음을 만드는 호출(켈프 기둥, 풀 무더기, 늘어진 잎, 벽 다발, 바닥 덮개 지점)마다 위치와 모양 파라미터를 기록합니다 (`worldgen.mjs`의 `RECORD`). 원본 난수 흐름은 그대로라 **배치는 원본과 동일**합니다.
- 잎 하나하나는 셰이더가 (그룹 번호, 잎 번호) 해시로 만든 난수로, 원본과 같은 규칙과 분포로 생성합니다 (`AbyssGrow.cginc`, 같은 내용의 JS 기준 구현 `exporter/grow.mjs`). 잎 단위로 원본과 똑같지는 않지만 같은 숲입니다.
- 데이터: 그룹 3,700개 + 바닥 덮개 지점 23만 개 + 잎→그룹 번호표, 압축 후 약 1.4 MB (원본 잎을 그대로 담으면 High 기준 70 MB 이상).

### 그리기 구조 (인스턴싱)
- **템플릿 메시**: 잎 하나(또는 바위 하나, 사각형 하나)를 K번 복사한 메시. 각 정점은 uv에 자기 슬롯 번호를 들고 있습니다.
- **렌더러마다 `_Base`, `_Count`** (MaterialPropertyBlock, `AbyssInstanceTable`): 슬롯 → 잎/바위 번호. 넘치는 슬롯은 접혀서 안 그려집니다.
- **셀 단위 컬링**: 24 m 셀마다 렌더러, Unity frustum culling + LODGroup으로 먼 셀을 끄고, 거리 대역(잎 9줄 0–24 m, 5줄 24–58 m, 먼 잎 58–150 m 등)은 셰이더가 인스턴스별로 자릅니다.
- 작은 바위·자갈·스펀지·산호는 셀 중심 기준 half float 2텍셀로 압축 저장 (회전은 쿼터니언 xyz).

### 원본 기능 → Unity
| 웹 버전 | VRChat 버전 |
|---|---|
| 지형 밀도장 GPU 컴퓨트 → 메시 | 익스포터에서 CPU 계산 → 거리장으로 구워 레이마칭 |
| 잎 220만 장, 반짝이 66만 개 (CPU 생성) | 배치 기록만 저장, 정점 셰이더가 생성 |
| 바위 디테일 텍스처 (로딩 때 렌더) | 같은 방식: 로딩 때 CustomRenderTexture가 한 번 생성 (`AbyssDetail.shader`) |
| 그림자 맵 (로딩 때 한 번 렌더) | 익스포터에서 미리 구운 16비트 텍스처, 셰이더에서 Gather로 PCF |
| 물 텍스처 (매 프레임 렌더 패스) | CustomRenderTexture (Realtime, 밉맵 자동) |
| 빛줄기 (반해상도 + 블러) | 전체 해상도, 스텝 수 줄임 (`ABYSS_RAYN`), 블러 없음. 카메라 깊이 텍스처 필요 → 씬의 "Depth Light" |
| 후처리 (노출, 톤맵, 비네트, 디더) | `Post` 셰이더가 GrabPass로 같은 계산. Reference Camera의 HDR 필요 |
| 블룸 (6%) | 없음. 원하면 Post Processing v2의 Bloom만 켜고 Tonemapping은 끄기 |
| 수영 카메라 (WASD, Q/E, Shift, 1–6) | `AbyssSwim`: 중력 0, 보는 방향으로 이동, 같은 가속/속도(7 / 26 m/s), 지형 콜라이더와 충돌. 데스크톱 E·Space 위 / Q·C 아래 / Shift 빠르게 / 1–6 뷰포인트 / M 소리. VR은 왼쪽 스틱 이동, 오른쪽 스틱 위아래, 트리거 빠르게 |
| 실시간 합성 사운드 | 같은 그래프를 오프라인 렌더한 루프 4개 + 원샷(거품, 차임, 고래)을 `AbyssAmbience`가 원본 타이밍대로 재생. 수면 가까울수록 파도 소리, 빠를수록 물살 소리 |
| 동적 해상도 / 디테일 | 없음 (VRChat이 해상도를 정함). 대신 머티리얼의 `_AbyssDetailScale`로 그리는 거리 조절 가능 |

### 바뀌는 점, 확인할 점
- **애니메이션 동기화**: 물고기·만타·잎 흔들림은 각 플레이어의 `_Time` 기준이라 플레이어마다 위치가 다를 수 있습니다. 필요하면 서버 시간을 Udon에서 셰이더 전역값으로 넘기면 됩니다.
- **Depth Light**: 빛줄기용 깊이 텍스처를 얻으려고 넣은 디렉셔널 라이트입니다 (VRChat에서 흔히 쓰는 방법). Culling Mask를 빈 레이어(Water)로 해 두었는데, 깊이 텍스처가 안 생기면(빛줄기가 바위를 뚫고 보이면) Culling Mask를 바꿔 보세요. 깊이 프리패스 비용이 있으니 성능이 부족하면 "Light Shafts"와 이 라이트를 끄면 됩니다.
- **HDR**: Post 셰이더는 HDR 버퍼를 전제로 톤매핑합니다. 화면이 하얗게 날아가거나 칙칙하면 Reference Camera의 HDR, Post Processing의 Tonemapping 설정을 확인하세요.
- **업로드 용량**: 압축 후 약 10 MB 예상. 남은 큰 항목은 템플릿 메시(약 2.5 MB, 복제 메시), 지형 SDF 1.9 MB, 그림자 맵 1.3 MB, 바닥 덮개 지점 1.2 MB, 볼륨 1.1 MB입니다.
- **레이마칭 셰이딩과 밉맵**: 레이마칭 결과에 텍스처를 입힐 때 화면 미분으로 밉 레벨을 고르는데, 지형 실루엣 경계에서는 이웃 화소가 서로 다른 표면이라 가는 선이 보일 수 있습니다. 보이면 거리 기반 LOD로 바꾸면 됩니다.

## 제약
- **PC 전용.** 정점 셰이더 텍스처 읽기, float 텍스처, Shader Model 4.5(Gather), GrabPass, 수백만 정점을 씁니다. Quest/Android용은 따로 훨씬 가벼운 버전(구운 메시 + 단순 셰이더)이 필요합니다.
- VR 성능은 아직 측정 안 했습니다. 웹 버전 High는 RTX 5070 Ti 1440p 기준이고, VR은 화소가 훨씬 많아서 기본값을 Medium으로 했습니다. 부족하면 Low, `_AbyssDetailScale` 낮추기, 빛줄기 끄기 순으로 줄이세요.

## 파일

| 경로 | 내용 |
|---|---|
| `exporter/export.mjs` | 익스포터 본체: 월드 생성 → 텍스처, 지형 셀 메시, 템플릿 메시, 인스턴스 텍스처, 그림자 맵, `manifest.json`, `AbyssConfig.cginc` |
| `exporter/worldgen.mjs` | `source/src`의 `math.js`, `world.js`와 `main.js` 일부를 그대로 불러 실행 (복사본 아님: 원본을 고치면 VRChat 쪽도 따라감) |
| `exporter/density.mjs`, `detail.mjs`, `shadow.mjs` | GPU에서 하던 지형 밀도장, 디테일 텍스처(검증용), 그림자 맵의 CPU 버전 |
| `exporter/sdf.mjs` | 지형 거리장 굽기 |
| `exporter/grow.mjs` | 식물 배치 기록 패킹 + 잎 생성 JS 기준 구현 (`AbyssGrow.cginc`와 한 줄씩 대응) |
| `exporter/raymarch-preview.mjs`, `original-preview.mjs` | WebGPU 레이마칭 미리보기 / 원본 렌더 (개발용) |
| `exporter/audio.mjs` | 사운드 렌더러 (Playwright + ffmpeg). 결과물은 이미 커밋되어 있어 다시 돌릴 필요 없음 |
| `exporter/verify-*.mjs` | 원본 WebGPU 결과와 비교하는 검증 스크립트 (Playwright 필요, `npm run verify`) |
| `Assets/AbyssalGarden/Shaders/` | HLSL 포팅. `AbyssCommon.cginc`가 원본 `S_G`/`S_B`, 나머지가 각 WGSL 셰이더에 대응 |
| `Assets/AbyssalGarden/Editor/AbyssImporter.cs` | Import World 메뉴 |
| `Assets/AbyssalGarden/Scripts/` | UdonSharp: `AbyssInstanceTable`, `AbyssSwim`, `AbyssAmbience` |
| `Assets/AbyssalGarden/Audio/` | 렌더된 사운드 |

## 문제가 생기면
- **분홍색** → 셰이더 컴파일 에러. Console 확인 (`#pragma target 4.5`, `GatherRed`, 스테레오 매크로 쪽이 의심 1순위).
- **식물·바위가 안 보임** (씬 뷰) → Refresh Scene View Preview. Play 중에도 안 보이면 `AbyssInstanceTable`의 배열이 채워졌는지 확인.
- **지형이 안 보이거나 식물이 지형을 뚫고 보임** → "Terrain (raymarched)"의 머티리얼에 SDF 텍스처가 들어갔는지, 셰이더가 깊이(SV_Depth)를 쓰는지 확인.
- **모든 게 너무 어둡거나 하얗게 뜸** → 카메라 HDR, 프로젝트 Color Space가 Linear인지.
- **빛줄기가 바위 앞에 뿌옇게** → 깊이 텍스처 없음 (Depth Light).
- **이상하게 뒤집힌 면 / 안 보이는 면** → 좌표 z 뒤집기와 와인딩: `AbyssFlip`, 익스포터의 와인딩 반전, Terrain `Cull Back`.
