# BT-055: Whisper runtime build workflow and release

## Status

**Status:** In Progress  
**Priority:** High  
**Board id:** none — repo infrastructure  
**Started:** 2026-10-25  
**Completed:** —

## Goal

Add a manually triggered GitHub Actions workflow that builds whisper.cpp `whisper-server` for Windows x64 from a selected upstream tag, smoke-tests the CPU path, packages only the server and its runtime DLLs with notices and checksums, then publishes a separately tagged GitHub Release. BT-056 downloads this runtime on a user click and pins the archive SHA-256; this task does not create the Speech to Text board.

## Background

- Canonical project instructions: [`CLAUDE.md`](../../../CLAUDE.md). The repository catalog publisher releases board ZIPs using per-board tags, while task documents and workflows are repo-only.
- Epic: [EPIC-133 in persephone](../../../../persephone/doc/epics/EPIC-133.md). Its engine measurements show Vulkan materially faster on the measured Intel Arc machine; its design says the board downloads runtime/model on explicit user action; Concern 2 requires a non-board release tag; Concern 3 asks for optional Vulkan/CPU fallback; Concern 6 leaves endpoint details to the pinned-source verification in this task. Live typing, silence auto-stop, shared capture, and dictation hotkey remain future work and do not change this build.
- The Speech Transcription guide is context only: [`speech-transcribe.md`](../../../../persephone/assets/guides/agents/speech-transcribe.md). It defines the provider contract but BT-055 does not implement it.
- Pinned upstream: [ggml-org/whisper.cpp `v1.9.5`](https://github.com/ggml-org/whisper.cpp/tree/v1.9.5), release commit `d1be6fd` ([release evidence](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5)). The tag's `CMakeLists.txt` identifies 1.9.5, and the release page resolves the tag to that commit.
- Upstream's [`release.yml`](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/.github/workflows/release.yml#L126-L197) Windows job uses `windows-latest`, `BUILD_SHARED_LIBS=ON`, `GGML_NATIVE=OFF`, and for x64 `GGML_BACKEND_DL=ON` plus `GGML_CPU_ALL_VARIANTS=ON`; it packages the `build/bin/Release` output into `whisper-bin-x64.zip`. This is the proven CPU-variant/dynamic-backend configuration reused below. The release workflow at this tag has no Vulkan job or Vulkan SDK installation. The other Windows CI workflow ([`build-windows.yml`](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/.github/workflows/build-windows.yml)) uses MSYS2, not Vulkan. Thus there is no upstream Vulkan install action/version to reuse. The proposal downloads LunarG's versioned x64 installer URL directly, following LunarG's documented unattended installer switches ([Windows SDK install guide](https://vulkan.lunarg.com/doc/view/1.3.296.0/windows/getting_started.html#unattended-installation)); pin `1.4.363.0`, the SDK version used in the verified local build. The installer SHA-256 in the YAML matches a local copy of the 1.4.363.0 installer (verified 2026-10-25) and the [Scoop package manifest](https://github.com/ScoopInstaller/Main/blob/master/bucket/vulkan.json), which records the same versioned LunarG download URL and digest.
- The local build findings supplied for this task are consistent with upstream's release setup: use Ninja under the x64 MSVC developer environment; keep source and nested Vulkan build directories short to avoid the shader generator's Windows MAX_PATH failure; and build from a clean temporary path rather than relying on MSBuild's file tracker there.

## Verified Decisions and Evidence

### One hybrid runtime, with a supported CPU-only switch

Recommend one package built with `GGML_BACKEND_DL=ON`, `GGML_CPU_ALL_VARIANTS=ON`, `GGML_NATIVE=OFF`, and `GGML_VULKAN=ON`, rather than two complete server builds. The v1.9.5 `ggml-backend-reg.cpp` dynamically searches the executable directory for `ggml-vulkan-*.dll` and `ggml-cpu-*.dll`, chooses the best-scoring variant, and attempts the Vulkan backend before CPU ([loader and search behavior](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/ggml/src/ggml-backend-reg.cpp#L205-L245), [plugin names and search order](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/ggml/src/ggml-backend-reg.cpp#L431-L559)). Failure to load a dynamic backend is handled as a failed optional backend load; Whisper still appends and requires its CPU backend when setting up its backend list ([Whisper backend initialization](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/src/whisper.cpp#L1216-L1278)). This supports CPU operation when Vulkan's loader/device is absent or backend initialization fails.

The server's `-ng` / `--no-gpu` option is present at v1.9.5, sets `use_gpu=false`, and is passed into `whisper_context_params` ([option parse/use](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L166-L171), [parse and context setup](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L220-L241), [context setup](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L632-L637)). `server.cpp:642` calls `ggml_backend_load_all()` before loading the model, and [`ggml/src/CMakeLists.txt:387`](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/ggml/src/CMakeLists.txt#L387) adds a dependency from `ggml` to each backend, so building `--target whisper-server` also builds the MODULE backends. The smoke test will first run with the server's default GPU preference on the GPU-less runner; successful transcription then demonstrates fallback to CPU when Vulkan has no usable device. It will run a second time with `--no-gpu` to verify the explicit CPU option as well. This verifies discovery/initialization fallback, not recovery from arbitrary mid-inference device loss.

### Static MSVC runtime

Set `CMAKE_POLICY_DEFAULT_CMP0091=NEW` and `CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded` so the EXE and DLLs link the static MSVC CRT. This avoids requiring end users to install the Microsoft Visual C++ Redistributable. The executable and all runtime DLLs are built together with this setting; the archive still depends on normal Windows system DLLs and a system Vulkan driver/loader for Vulkan acceleration. The Vulkan SDK itself is build-only and is not copied into the archive.

### Tag and release metadata

Use `whisper-runtime-1.9.5-r1`, derived from the validated upstream tag and numeric runtime revision. In [`scripts/publish-board.mjs:239`](../../../scripts/publish-board.mjs#L239), the publisher constructs board tags exactly as `${id}-v${m.version}`; the runtime tag has no `-v` delimiter, so it cannot equal that board-release shape regardless of board id or version. The publisher does not inspect GitHub releases' Latest marker. Still pass `gh release create --latest=false` to avoid moving the repository's Latest marker ([GitHub CLI docs](https://cli.github.com/manual/gh_release_create)).

Proposed release title: `Whisper Runtime 1.9.5 r1 (whisper-runtime-1.9.5-r1)`.

Proposed release body: `Windows x64 whisper-server runtime built from ggml-org/whisper.cpp v1.9.5 (upstream commit d1be6fd). Built with dynamically loaded Vulkan and CPU backends; CPU variants are selected at runtime. Includes the upstream notices and per-file SHA-256 manifest. The attached .sha256 file covers the ZIP bytes. Smoke-tested on windows-latest with the bundled tiny model and localhost /inference endpoint, first using default GPU preference to verify CPU fallback without a usable Vulkan device, then with --no-gpu.`

Release asset names:

- `whisper-runtime-windows-x64-v1.9.5-r1.zip`
- `whisper-runtime-windows-x64-v1.9.5-r1.zip.sha256`

### Package contents and notices

`examples/server/CMakeLists.txt` builds `whisper-server` from `server.cpp` and `httplib.h`, and links `common`, `json_cpp`, `whisper`, threads, and Windows `ws2_32` ([target definition](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/CMakeLists.txt#L1-L14)). `examples/CMakeLists.txt` defines `common` from `common.cpp` and `common-whisper.cpp` ([common target](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/CMakeLists.txt#L15-L61)); `common-whisper.cpp` includes `stb_vorbis.c` and compiles miniaudio's implementation ([compiled common dependencies](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/common-whisper.cpp#L8-L25)). `server.cpp` includes `httplib.h` and `json.hpp` ([server includes](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L0-L25)). Therefore ship notices for:

- whisper.cpp and vendored ggml: root upstream MIT `LICENSE` (the `ggml/` directory has no separate LICENSE at this tag).
- cpp-httplib: MIT notice from `examples/server/httplib.h` (copyright Yuji Hirose, 2025). The server uses its default HTTP-only configuration; no OpenSSL or other external cpp-httplib runtime dependency is enabled. Windows sockets link to the OS `ws2_32.dll`.
- nlohmann/json: MIT notice for the vendored `examples/json.hpp` (`ordered_json` is used by the server), plus the embedded UTF-8 decoder and Grisu2 attributions and Hedley CC0-1.0 notice listed by [nlohmann's license page](https://nlohmann.github.io/json/home/license/).
- miniaudio: public-domain / MIT-0 choice; retain the David Reid 2025 notice and MIT-0 text (source license at [`examples/miniaudio.h`](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/miniaudio.h#L89226-L89267)).
- stb_vorbis: MIT alternative, copyright Sean Barrett 2017; retain its MIT notice (source license at [`examples/stb_vorbis.c`](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/stb_vorbis.c#L5201-L5221)).

Vulkan headers and shader compiler are build-time only and are not packaged. The upstream Visual Studio release job's output is `build/bin/Release`; the proposed Ninja single-configuration workflow copies `C:\\w\\b\\bin` instead. It takes `whisper-server.exe` and all DLLs emitted there (including ggml core DLLs, every CPU variant, and `ggml-vulkan.dll`), not the other example executables. The backend loader's search path is the executable directory, so keeping the DLLs beside the EXE is required.

Proposed ZIP root:

```text
whisper-server.exe
<all emitted runtime DLLs>
README.txt
manifest.json
licenses/
  whisper.cpp-ggml-MIT.txt
  cpp-httplib-MIT.txt
  nlohmann-json-MIT-and-notices.txt
  miniaudio-MIT-0.txt
  stb-vorbis-MIT.txt
```

The JSON manifest hashes every other packaged file by relative path; it cannot contain its own SHA-256 without a self-referential definition. The detached `.sha256` asset hashes the exact ZIP bytes. The archive therefore includes checksums for payload files and the release carries a ZIP checksum for BT-056 to pin.

### Smoke test details

The v1.9.5 server README confirms `--host`, `--port`, `/inference`, `file`, `response_format=json`, and multipart form upload ([server usage](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/README.md#request-examples)); `server.cpp` defaults to `127.0.0.1:8080`, registers `POST /inference`, `GET /health`, checks for multipart field `file`, and returns JSON with a top-level `text` ([handler and health path](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L777-L790), [health path](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L1133-L1142), [JSON response](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/server/server.cpp#L1079-L1090)). CI downloads `samples/jfk.wav` from the selected upstream checkout and uses one PowerShell helper twice: first with the default GPU preference and then with `--no-gpu`. Each run binds to localhost, waits for `/health`, posts multipart `file`, `response_format=json`, `temperature=0.0`, and `temperature_inc=0.2`, asserts that the lowercase response includes `ask not what you can do`, stops the process in `finally`, and prints filtered backend/device lines from that run's stderr log.

Download the tiny model from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin) and validate SHA-256 `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` before starting the server. This value matches the SHA-256 `lfs.oid` reported by Hugging Face's [paths-info API for ggerganov/whisper.cpp](https://huggingface.co/api/models/ggerganov/whisper.cpp/paths-info/main/ggml-tiny.bin); the model card's short `SHA` column is a different model checksum and must not be used as SHA-256.

### Workflow trigger, action pins, and permissions

Proposed path: `.github/workflows/build-whisper-runtime.yml`. Inputs are `upstream_tag` (validated `vMAJOR.MINOR.PATCH`, default `v1.9.5`) and `runtime_revision` (validated positive integer, default `1`). All Actions references below are full commit SHAs. The build job has `contents: read` only; only the separate publish job has `contents: write`, needed by `gh release create`. `actions/upload-artifact` and `actions/download-artifact` transfer the built ZIP and checksum between jobs. No workflow is triggered as part of BT-055 documentation work.

## Implementation Plan

- [x] Add `.github/workflows/build-whisper-runtime.yml` using the reviewed workflow YAML below. Keep the checkout of this repository on a pinned full Action SHA; clone upstream at the validated tag into a short path; validate the tag/revision before constructing shell arguments.
- [x] Install the versioned LunarG Vulkan SDK directly from its 1.4.363.0 URL, use the documented unattended install options, install/pin Ninja, invoke `vcvars64.bat`, and build only `whisper-server` with the flags in the YAML.
- [x] Run the checksum-verified tiny-model and localhost `/inference` smoke test once with default GPU preference and once with `--no-gpu`, printing backend/device stderr lines for both runs.
- [x] Package only `whisper-server.exe`, generated DLLs, README, manifest, and notices; compute payload SHA-256 values and a detached ZIP checksum.
- [x] Transfer the artifact to a separate least-privilege job and create the prefixed release with `--latest=false`.
- [x] Add the new workflow to the workflow lists in `README.md` and `CLAUDE.md`; keep both descriptions clear that it publishes the separately versioned runtime and is manual-only.
- [ ] BT-056 pins the uploaded ZIP's SHA-256 in its download implementation after the first approved release is created.

### Complete proposed workflow YAML

```yaml
name: Build Whisper Runtime

on:
  workflow_dispatch:
    inputs:
      upstream_tag:
        description: "whisper.cpp upstream release tag"
        required: true
        default: "v1.9.5"
        type: string
      runtime_revision:
        description: "Runtime package revision for this upstream tag"
        required: true
        default: "1"
        type: string

permissions:
  contents: read

concurrency:
  group: whisper-runtime-${{ inputs.upstream_tag }}-${{ inputs.runtime_revision }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: windows-latest
    permissions:
      contents: read
    steps:
      - name: Checkout workflow repository
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6

      - name: Validate inputs and clone upstream to a short path
        shell: pwsh
        env:
          UPSTREAM_TAG: ${{ inputs.upstream_tag }}
          RUNTIME_REVISION: ${{ inputs.runtime_revision }}
        run: |
          $ErrorActionPreference = 'Stop'
          if ($env:UPSTREAM_TAG -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'upstream_tag must be vMAJOR.MINOR.PATCH' }
          if ($env:RUNTIME_REVISION -notmatch '^[1-9][0-9]*$') { throw 'runtime_revision must be a positive integer' }
          New-Item -ItemType Directory -Force C:\w | Out-Null
          git clone --depth 1 --branch $env:UPSTREAM_TAG https://github.com/ggml-org/whisper.cpp.git C:\w\src
          if ($LASTEXITCODE -ne 0) { throw 'Upstream clone failed' }
          $commit = (git -C C:\w\src rev-parse HEAD).Trim()
          if ($LASTEXITCODE -ne 0) { throw 'Could not resolve upstream commit' }
          "UPSTREAM_COMMIT=$commit" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
          "RUNTIME_TAG=whisper-runtime-$($env:UPSTREAM_TAG.Substring(1))-r$($env:RUNTIME_REVISION)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
          "ASSET_STEM=whisper-runtime-windows-x64-$($env:UPSTREAM_TAG)-r$($env:RUNTIME_REVISION)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8

      - name: Install Vulkan SDK 1.4.363.0
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          $installer = 'C:\w\vulkansdk-windows-X64-1.4.363.0.exe'
          Invoke-WebRequest 'https://sdk.lunarg.com/sdk/download/1.4.363.0/windows/vulkansdk-windows-X64-1.4.363.0.exe' -OutFile $installer
          $expected = '94a82d378f7a5e3e54c9db7d2fb7016af136e14ac0a18dbf0f2f67a36352d141'
          $actual = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($actual -ne $expected) { throw "Vulkan SDK installer SHA-256 mismatch: $actual" }
          $proc = Start-Process -FilePath $installer -ArgumentList @('--root', 'C:\w\vulkan', '--accept-licenses', '--default-answer', '--confirm-command', 'install') -Wait -PassThru
          if ($proc.ExitCode -ne 0) { throw "Vulkan SDK installer exited $($proc.ExitCode)" }
          "VULKAN_SDK=C:\w\vulkan" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
          "VK_SDK_PATH=C:\w\vulkan" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
          "C:\w\vulkan\Bin" | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8

      - name: Ensure Ninja
        shell: pwsh
        run: |
          # windows-latest ships Ninja; install it only when an image lacks it.
          if (-not (Get-Command ninja -ErrorAction SilentlyContinue)) { choco install ninja --yes --no-progress; if ($LASTEXITCODE -ne 0) { throw 'Ninja install failed' } }
          ninja --version

      - name: Configure and build whisper-server
        shell: cmd
        run: |
          set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
          if not exist "%VSWHERE%" (
            echo ERROR: Visual Studio Installer vswhere.exe was not found at "%VSWHERE%".
            exit /b 1
          )
          for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_INSTALL=%%i"
          if not defined VS_INSTALL (
            echo ERROR: vswhere found no Visual Studio installation with the x86/x64 VC tools.
            exit /b 1
          )
          if not exist "%VS_INSTALL%\VC\Auxiliary\Build\vcvars64.bat" (
            echo ERROR: vcvars64.bat was not found under "%VS_INSTALL%".
            exit /b 1
          )
          call "%VS_INSTALL%\VC\Auxiliary\Build\vcvars64.bat"
          if errorlevel 1 exit /b 1
          cmake -S C:\w\src -B C:\w\b -G Ninja ^
            -DCMAKE_BUILD_TYPE=Release ^
            -DCMAKE_POLICY_DEFAULT_CMP0091=NEW ^
            -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded ^
            -DBUILD_SHARED_LIBS=ON ^
            -DWHISPER_BUILD_IS_DEV=OFF ^
            -DWHISPER_BUILD_EXAMPLES=ON ^
            -DWHISPER_BUILD_TESTS=OFF ^
            -DWHISPER_BUILD_SERVER=ON ^
            -DWHISPER_SDL2=OFF ^
            -DWHISPER_COMMON_FFMPEG=OFF ^
            -DGGML_NATIVE=OFF ^
            -DGGML_BACKEND_DL=ON ^
            -DGGML_CPU_ALL_VARIANTS=ON ^
            -DGGML_VULKAN=ON
          if errorlevel 1 exit /b 1
          cmake --build C:\w\b --config Release --target whisper-server --parallel
          if errorlevel 1 exit /b 1

      - name: Default fallback and CPU-only server smoke tests
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          $model = 'C:\w\ggml-tiny.bin'
          Invoke-WebRequest 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' -OutFile $model
          $expected = 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'
          $actual = (Get-FileHash $model -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($actual -ne $expected) { throw "tiny model SHA-256 mismatch: $actual" }
          function Invoke-WhisperSmoke {
            param([string]$RunName, [switch]$ForceCpu)
            $stdout = "C:\w\server.$RunName.stdout.log"
            $stderr = "C:\w\server.$RunName.stderr.log"
            $arguments = @('--model', $model, '--host', '127.0.0.1', '--port', '8080', '--language', 'auto')
            if ($ForceCpu) { $arguments += '--no-gpu' }
            Write-Host "Starting smoke run '$RunName'; --no-gpu supplied: $([bool]$ForceCpu)"
            $server = Start-Process -FilePath 'C:\w\b\bin\whisper-server.exe' -ArgumentList $arguments -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
            try {
              $ready = $false
              for ($i = 0; $i -lt 120; $i++) {
                if ($server.HasExited) { throw "whisper-server exited early: $((Get-Content $stderr -Raw))" }
                try {
                  $health = Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 2
                  if ($health.status -eq 'ok') { $ready = $true; break }
                } catch { Start-Sleep -Seconds 1 }
              }
              if (-not $ready) { throw "whisper-server ($RunName) did not become healthy within 120 seconds" }
              $form = @{
                file = Get-Item 'C:\w\src\samples\jfk.wav'
                response_format = 'json'
                temperature = '0.0'
                temperature_inc = '0.2'
              }
              $result = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/inference' -Form $form -TimeoutSec 300
              if (-not $result.text) { throw "Inference response did not contain text: $($result | ConvertTo-Json -Compress)" }
              $transcript = $result.text.ToLowerInvariant()
              if (-not $transcript.Contains('ask not what you can do')) { throw "Unexpected JFK transcript: $($result.text)" }
              Write-Host "Smoke run '$RunName' transcript: $($result.text)"
              if ($ForceCpu) { Write-Host "Backend conclusion for '$RunName': CPU forced by --no-gpu; inference succeeded." }
              else { Write-Host "Backend conclusion for '$RunName': no usable Vulkan GPU is present on this runner; successful inference used the CPU fallback." }
            } finally {
              if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
              Wait-Process -Id $server.Id -Timeout 10 -ErrorAction SilentlyContinue
              Write-Host "Backend/device stderr lines for '$RunName':"
              $backendLines = Select-String -Path $stderr -Pattern '(?i)backend|device|vulkan|cpu|gpu'
              if ($backendLines) { $backendLines | ForEach-Object { Write-Host $_.Line } }
              else { Write-Host '(no backend/device lines emitted)' }
            }
          }
          Invoke-WhisperSmoke -RunName 'default-fallback'
          Invoke-WhisperSmoke -RunName 'forced-cpu' -ForceCpu

      - name: Package runtime and checksums
        shell: pwsh
        env:
          UPSTREAM_TAG: ${{ inputs.upstream_tag }}
        run: |
          $ErrorActionPreference = 'Stop'
          $out = 'C:\w\package'
          New-Item -ItemType Directory -Force "$out\licenses" | Out-Null
          Copy-Item 'C:\w\b\bin\whisper-server.exe' $out
          Get-ChildItem 'C:\w\b\bin' -Filter '*.dll' | Copy-Item -Destination $out
          if (-not (Get-ChildItem $out -Filter '*.dll')) { throw 'No runtime DLLs were emitted' }
          $licenseRoot = 'C:\w\src'
          Copy-Item "$licenseRoot\LICENSE" "$out\licenses\whisper.cpp-ggml-MIT.txt"
          function Assert-NoticeSource {
            param([string]$Path, [string[]]$Patterns)
            foreach ($pattern in $Patterns) {
              if (-not (Select-String -Path $Path -SimpleMatch -Pattern $pattern -Quiet)) {
                throw "Expected notice identifier '$pattern' not found in $Path; re-verify third-party notices for this tag"
              }
            }
          }
          Assert-NoticeSource "$licenseRoot\examples\server\httplib.h" @('#define CPPHTTPLIB_VERSION "0.20.0"', 'Copyright (c) 2025 Yuji Hirose. All rights reserved.')
          @'
          cpp-httplib 0.20.0
          Copyright (c) 2025 Yuji Hirose. All rights reserved.
          MIT License

          Permission is hereby granted, free of charge, to any person obtaining a copy
          of this software and associated documentation files (the "Software"), to deal
          in the Software without restriction, including without limitation the rights
          to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
          copies of the Software, and to permit persons to whom the Software is
          furnished to do so, subject to the following conditions:

          The above copyright notice and this permission notice shall be included in all
          copies or substantial portions of the Software.

          THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
          AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
          LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
          OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
          SOFTWARE.
          '@ | Set-Content "$out\licenses\cpp-httplib-MIT.txt" -Encoding utf8
          Assert-NoticeSource "$licenseRoot\examples\json.hpp" @('Copyright (c) 2013-2026 Niels Lohmann')
          @'
          nlohmann/json (vendored examples/json.hpp), MIT License
          Copyright (c) 2013-2026 Niels Lohmann
          Includes the UTF-8 Decoder, Copyright (c) 2008-2009 Björn Hoehrmann, and
          modified Grisu2 algorithm, Copyright (c) 2009 Florian Loitsch, both under MIT.
          Includes Hedley by Evan Nemerson under CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/).

          Permission is hereby granted, free of charge, to any person obtaining a copy
          of this software and associated documentation files (the "Software"), to deal
          in the Software without restriction, including without limitation the rights
          to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
          copies of the Software, and to permit persons to whom the Software is
          furnished to do so, subject to the following conditions:

          The above copyright notice and this permission notice shall be included in all
          copies or substantial portions of the Software.

          THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
          AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
          LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
          OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
          SOFTWARE.
          '@ | Set-Content "$out\licenses\nlohmann-json-MIT-and-notices.txt" -Encoding utf8
          Assert-NoticeSource "$licenseRoot\examples\miniaudio.h" @('miniaudio - v0.11.24', 'Copyright 2025 David Reid')
          @'
          miniaudio v0.11.24
          Copyright 2025 David Reid
          Alternative 2: MIT No Attribution (MIT-0)

          Permission is hereby granted, free of charge, to any person obtaining a copy of
          this software and associated documentation files (the "Software"), to deal in
          the Software without restriction, including without limitation the rights to
          use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
          of the Software, and to permit persons to whom the Software is furnished to do
          so.

          THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
          AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
          LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
          OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
          SOFTWARE.
          '@ | Set-Content "$out\licenses\miniaudio-MIT-0.txt" -Encoding utf8
          Assert-NoticeSource "$licenseRoot\examples\stb_vorbis.c" @('Ogg Vorbis audio decoder - v1.22', 'Copyright (c) 2017 Sean Barrett')
          @'
          stb_vorbis v1.22
          Copyright (c) 2017 Sean Barrett
          MIT License

          Permission is hereby granted, free of charge, to any person obtaining a copy of
          this software and associated documentation files (the "Software"), to deal in
          the Software without restriction, including without limitation the rights to
          use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
          of the Software, and to permit persons to whom the Software is furnished to do
          so, subject to the following conditions:

          The above copyright notice and this permission notice shall be included in all
          copies or substantial portions of the Software.

          THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
          AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
          LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
          OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
          SOFTWARE.
          '@ | Set-Content "$out\licenses\stb-vorbis-MIT.txt" -Encoding utf8
          @"
          whisper.cpp Windows x64 runtime
          Upstream: ggml-org/whisper.cpp $env:UPSTREAM_TAG
          Commit: $env:UPSTREAM_COMMIT
          Architecture: Windows x64 (MSVC)
          Build: Release; CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded; BUILD_SHARED_LIBS=ON
          Flags: WHISPER_BUILD_IS_DEV=OFF; WHISPER_BUILD_EXAMPLES=ON; WHISPER_BUILD_TESTS=OFF;
          WHISPER_BUILD_SERVER=ON; WHISPER_SDL2=OFF; WHISPER_COMMON_FFMPEG=OFF;
          GGML_NATIVE=OFF; GGML_BACKEND_DL=ON; GGML_CPU_ALL_VARIANTS=ON; GGML_VULKAN=ON
          Vulkan SDK: LunarG 1.4.363.0 (build time only)
          Run: whisper-server.exe --model <model-path> --host 127.0.0.1 --port 8080
          Use --no-gpu to force CPU execution. Vulkan acceleration requires a compatible installed GPU driver.
          See licenses/ for the notices of components linked into this runtime.
          "@ | Set-Content "$out\README.txt" -Encoding utf8
          $files = Get-ChildItem $out -File -Recurse | Sort-Object { $_.FullName.Substring($out.Length + 1).Replace('\', '/') }
          $entries = foreach ($file in $files) {
            $relative = $file.FullName.Substring($out.Length + 1).Replace('\', '/')
            [ordered]@{ path = $relative; sha256 = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
          }
          [ordered]@{ upstreamTag = $env:UPSTREAM_TAG; upstreamCommit = $env:UPSTREAM_COMMIT; files = @($entries) } |
            ConvertTo-Json -Depth 5 | Set-Content "$out\manifest.json" -Encoding utf8
          $zip = "$env:GITHUB_WORKSPACE\$env:ASSET_STEM.zip"
          Compress-Archive -Path "$out\*" -DestinationPath $zip -CompressionLevel Optimal
          $zipHash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
          "$zipHash  $([IO.Path]::GetFileName($zip))" | Set-Content "$zip.sha256" -Encoding ascii

      - name: Upload release payload
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6
        with:
          name: whisper-runtime-payload
          path: |
            ${{ github.workspace }}\whisper-runtime-windows-x64-${{ inputs.upstream_tag }}-r${{ inputs.runtime_revision }}.zip
            ${{ github.workspace }}\whisper-runtime-windows-x64-${{ inputs.upstream_tag }}-r${{ inputs.runtime_revision }}.zip.sha256
          if-no-files-found: error
          retention-days: 2

  publish:
    runs-on: windows-latest
    needs: build
    permissions:
      contents: write
    steps:
      - name: Download release payload
        uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6.0.0
        with:
          name: whisper-runtime-payload
          path: release

      - name: Create runtime release
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          UPSTREAM_TAG: ${{ inputs.upstream_tag }}
          RUNTIME_REVISION: ${{ inputs.runtime_revision }}
        run: |
          $ErrorActionPreference = 'Stop'
          if ($env:UPSTREAM_TAG -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$' -or $env:RUNTIME_REVISION -notmatch '^[1-9][0-9]*$') { throw 'Invalid release inputs' }
          $tag = "whisper-runtime-$($env:UPSTREAM_TAG.Substring(1))-r$($env:RUNTIME_REVISION)"
          $stem = "whisper-runtime-windows-x64-$($env:UPSTREAM_TAG)-r$($env:RUNTIME_REVISION)"
          $zip = "release\$stem.zip"
          $checksum = "$zip.sha256"
          if (-not (Test-Path $zip) -or -not (Test-Path $checksum)) { throw 'Release ZIP or checksum asset is missing' }
          $expected = ((Get-Content $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
          $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($actual -ne $expected) { throw 'ZIP checksum does not match detached checksum file' }
          gh release view $tag *> $null
          if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists; choose a new runtime_revision" }
          $notes = @"
          Windows x64 whisper-server runtime built from ggml-org/whisper.cpp $env:UPSTREAM_TAG.

          Built with dynamically loaded Vulkan and CPU backends. CPU variants are selected at runtime. Includes upstream notices and a per-file SHA-256 manifest. The attached .sha256 file covers the ZIP bytes.

          Smoke-tested on windows-latest with a SHA-256-verified tiny model, localhost /inference multipart upload of upstream samples/jfk.wav, once with default GPU preference to prove CPU fallback without a usable Vulkan device and once with --no-gpu. Backend/device stderr lines are printed for both runs.
          "@
          gh release create $tag $zip $checksum --target $env:GITHUB_SHA --title "Whisper Runtime $($env:UPSTREAM_TAG.Substring(1)) r$($env:RUNTIME_REVISION) ($tag)" --notes $notes --latest=false
          if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
```

## Concerns / Open Questions

- The Vulkan backend's dynamic loader path and CPU backend availability have source support. CI proves CPU fallback on a GPU-less runner and the explicit `--no-gpu` path; a GPU-enabled acceleration smoke test belongs with BT-056/manual release verification.
- The SDK installer URL is versioned and its SHA-256 is checked before installation; its large download will make a manual build take several minutes.
- `manifest.json` is defined to hash every payload file except itself, because a file cannot include its own stable SHA-256. The detached checksum is for the final ZIP bytes.
- Release reruns with an existing derived tag fail before publication. Increment `runtime_revision` for rebuilt bits from the same upstream tag; do not overwrite an asset BT-056 may already pin.
- The proposed build packages all emitted DLLs so every dynamic CPU variant and the Vulkan backend DLL remain adjacent to the EXE. It excludes every other executable and does not bundle the Vulkan SDK or model.
- The initial release tag is `whisper-runtime-1.9.5-r1`. In [`scripts/publish-board.mjs:239`](../../../scripts/publish-board.mjs#L239), board tags are exactly `${id}-v${m.version}`; because the runtime tag has no `-v` before its version, it cannot match that publisher shape.
- Upstream `samples/jfk.wav` is checked out at the selected tag. The transcript assertion checks stable words rather than exact punctuation/capitalization.

## Acceptance Criteria

- [x] A `workflow_dispatch` workflow accepts and validates upstream tag and runtime revision inputs.
- [x] Windows x64 `whisper-server` builds from the selected upstream tag with upstream's dynamic backend/CPU variant flags plus Vulkan.
- [x] The workflow verifies the SDK installer and tiny-model SHA-256 before use.
- [x] Smoke tests start on `127.0.0.1` once with default GPU preference and once with `--no-gpu`; each waits on `/health`, posts `samples/jfk.wav` to `/inference`, checks expected transcript words, stops the process, and prints backend/device stderr lines.
- [x] ZIP contains the server, required DLLs, `licenses/`, `README.txt`, and per-file `manifest.json`; `.sha256` covers the ZIP.
- [ ] Published tag is `whisper-runtime-<version>-r<revision>` (for example, `whisper-runtime-1.9.5-r1`), assets are attached, and release is explicitly not Latest.
- [x] Only the publish job receives `contents: write`; every third-party Action is pinned to a full commit SHA.
- [x] `README.md` and `CLAUDE.md` list the manual runtime workflow.

## Files Changed

| File | Change |
|------|--------|
| `doc/tasks/BT-055-whisper-runtime/README.md` | New — investigation evidence, design decisions, acceptance criteria, and complete proposed workflow YAML. |
| `doc/active-work.md` | Updated — move EPIC-133 task block to Active and link BT-055 to this document. |

### Files with no changes in this documentation task

- `.github/workflows/build-whisper-runtime.yml` — proposed in the YAML above; not created by this task.
- `README.md`, `CLAUDE.md` — workflow documentation changes are implementation follow-up.
- `boards/`, board manifests, and `scripts/publish-board.mjs` — no board is created or changed, and publisher logic remains unchanged.
- Persephone's `EPIC-133.md` and `assets/guides/agents/speech-transcribe.md` — read-only context.

## Notes

- The template's “Board id” field is `none` because this is repository infrastructure and creates no `boards/<id>/` folder.
- Workflows are documented in both the repository layout sections of `README.md` and `CLAUDE.md`; implementation should add the runtime workflow there while preserving the existing Publish Boards description.
- For BT-056, the default model `ggml-large-v3-turbo-q5_0.bin` is 574041195 bytes with SHA-256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`, from the [ggerganov/whisper.cpp Hugging Face paths-info API](https://huggingface.co/api/models/ggerganov/whisper.cpp/paths-info/main/ggml-large-v3-turbo-q5_0.bin), verified 2026-10-25.
- No workflow was run, no release was created, and no commit was made as part of this investigation.
