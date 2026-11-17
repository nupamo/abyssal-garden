# Abyssal Garden → VRChat 월드 포팅

웹 버전(`source/`)과 **같은 월드**를 VRChat(PC) 월드로 옮기는 작업 폴더입니다.
Unity 없이 할 수 있는 작업(데이터 익스포터, 셰이더·스크립트 포팅, 사운드 렌더링, 검증)은 끝냈고,
**Unity 쪽 코드(C#, HLSL)는 아직 한 번도 Unity에서 컴파일하거나 실행해 보지 않았습니다.** 집에서 처음 열 때 컴파일 에러를 몇 개 고쳐야 할 수 있습니다.

## 지금 상태

| | 상태 |
|---|---|
| 월드 생성 (지형, 켈프, 바위, 산호, 물고기…) | ✅ 웹 버전 생성 코드를 Node에서 그대로 실행 (`exporter/worldgen.mjs`) |
| 지형 밀도장 (원본은 GPU 컴퓨트 셰이더) | ✅ CPU로 포팅, 원본 WGSL과 비교 검증: 오차 0.001 이하, 안/밖 판정 불일치 0 |
| 바위 디테일 텍스처 | ✅ CPU로 포팅, 원본 GPU 결과와 1/255 이내로 일치 |
| 태양 그림자 맵 | ✅ CPU 래스터라이저로 미리 구워 둠. 웹 버전이 실제로 그린 그림자 맵과 비교해서 텍셀 98.9% 일치, 깊이 차이 중앙값 7 mm |
| 인스턴스 데이터 패킹 | ✅ 셰이더와 같은 방식으로 디코딩해 왕복 검증 (양자화 오차 범위 안) |
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

- 약 1.5~2분, 출력 약 180 MB → `vrchat/Assets/AbyssalGarden/Raw~/` (git에는 안 올라감; Unity는 `~`로 끝나는 폴더를 무시합니다)
- 기본은 **Medium** 디테일. `npm run export:high`(전체, PC 고사양) / `npm run export:low`도 있습니다.
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

### 인스턴싱 (켈프 잎 150만 장, 바위 수만 개)
VRChat에서는 `DrawMeshInstanced`류를 마음대로 못 쓰고 GameObject 수십만 개는 불가능해서, 이렇게 했습니다.

- **템플릿 메시**: 잎 하나(또는 바위 하나, 사각형 하나)를 K번 복사한 메시. 각 정점은 uv에 자기가 몇 번째 슬롯인지 들고 있습니다.
- **인스턴스 텍스처**: 인스턴스 데이터(위치, 회전, 종류, 시드…)를 RGBA32F 텍스처에 저장. 정점 셰이더가 `_Base + slot` 번째 레코드를 읽어 원본 WGSL 정점 셰이더와 같은 계산을 합니다.
- **렌더러마다 `_Base`, `_Count`**: MaterialPropertyBlock으로 지정 (`AbyssInstanceTable`). `_Count`를 넘는 슬롯은 접혀서 안 그려집니다.
- **셀 단위 컬링**: 원본처럼 24 m 셀로 나눠 셀마다 렌더러를 두고, Unity frustum culling + LODGroup으로 거리 밖의 셀을 통째로 끕니다. 거리 대역(예: 잎 9줄 0–24 m, 5줄 24–58 m, 먼 잎 58–150 m)은 셰이더가 인스턴스별로 정확히 자릅니다.
- 렌더러 약 4,000개, 대부분은 멀리서 꺼집니다.

### 원본 기능 → Unity
| 웹 버전 | VRChat 버전 |
|---|---|
| 지형 밀도장 GPU 컴퓨트 | 익스포터에서 CPU 계산 |
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
- **업로드 용량**: Medium 기준 원시 데이터 약 180 MB(압축 전). 빌드 후 용량이 크면 `npm run export:low` 또는 `--shadow 2048`.

## 제약
- **PC 전용.** 정점 셰이더 텍스처 읽기, float 텍스처, Shader Model 4.5(Gather), GrabPass, 수백만 정점을 씁니다. Quest/Android용은 따로 훨씬 가벼운 버전(구운 메시 + 단순 셰이더)이 필요합니다.
- VR 성능은 아직 측정 안 했습니다. 웹 버전 High는 RTX 5070 Ti 1440p 기준이고, VR은 화소가 훨씬 많아서 기본값을 Medium으로 했습니다. 부족하면 Low, `_AbyssDetailScale` 낮추기, 빛줄기 끄기 순으로 줄이세요.

## 파일

| 경로 | 내용 |
|---|---|
| `exporter/export.mjs` | 익스포터 본체: 월드 생성 → 텍스처, 지형 셀 메시, 템플릿 메시, 인스턴스 텍스처, 그림자 맵, `manifest.json`, `AbyssConfig.cginc` |
| `exporter/worldgen.mjs` | `source/src`의 `math.js`, `world.js`와 `main.js` 일부를 그대로 불러 실행 (복사본 아님: 원본을 고치면 VRChat 쪽도 따라감) |
| `exporter/density.mjs`, `detail.mjs`, `shadow.mjs` | GPU에서 하던 지형 밀도장, 디테일 텍스처, 그림자 맵의 CPU 버전 |
| `exporter/audio.mjs` | 사운드 렌더러 (Playwright + ffmpeg). 결과물은 이미 커밋되어 있어 다시 돌릴 필요 없음 |
| `exporter/verify-*.mjs` | 원본 WebGPU 결과와 비교하는 검증 스크립트 (Playwright 필요, `npm run verify`) |
| `Assets/AbyssalGarden/Shaders/` | HLSL 포팅. `AbyssCommon.cginc`가 원본 `S_G`/`S_B`, 나머지가 각 WGSL 셰이더에 대응 |
| `Assets/AbyssalGarden/Editor/AbyssImporter.cs` | Import World 메뉴 |
| `Assets/AbyssalGarden/Scripts/` | UdonSharp: `AbyssInstanceTable`, `AbyssSwim`, `AbyssAmbience` |
| `Assets/AbyssalGarden/Audio/` | 렌더된 사운드 |

## 문제가 생기면
- **분홍색** → 셰이더 컴파일 에러. Console 확인 (`#pragma target 4.5`, `GatherRed`, 스테레오 매크로 쪽이 의심 1순위).
- **식물·바위가 안 보임** (씬 뷰) → Refresh Scene View Preview. Play 중에도 안 보이면 `AbyssInstanceTable`의 배열이 채워졌는지 확인.
- **모든 게 너무 어둡거나 하얗게 뜸** → 카메라 HDR, 프로젝트 Color Space가 Linear인지.
- **빛줄기가 바위 앞에 뿌옇게** → 깊이 텍스처 없음 (Depth Light).
- **이상하게 뒤집힌 면 / 안 보이는 면** → 좌표 z 뒤집기와 와인딩: `AbyssFlip`, 익스포터의 와인딩 반전, Terrain `Cull Back`.
