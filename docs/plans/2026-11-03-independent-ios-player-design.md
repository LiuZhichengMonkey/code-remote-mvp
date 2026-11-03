# Independent iPhone torrent player

The user approved the standalone contract on 2026-11-03: add a magnet on the phone, download into phone storage, show progress/speed, play before completion, pause/resume and explicitly delete cached data. No computer or remote torrent service is part of the path.

## Reality and reuse

The existing Flutter screen is a remote client. Reuse its `video_player` AVPlayer integration, revision guard for switching, IPA packaging and isolated macOS workflow. Replace address/token entry and remote task transport with an embedded engine. The mobile directory has no complete Xcode project; keep generating the standalone project in CI.

Two published Flutter native torrent wrappers were inspected in `runtime/`. Their prebuilt GitHub repositories return 404, so they cannot support a reproducible delivery. Compiling libtorrent and its C++ dependency stack ourselves adds unnecessary build work. Use the available, pinned `github.com/anacrolix/torrent v1.58.1` engine, its file storage and seekable reader, with a small Go C archive and Flutter platform channel. The first v1.61.0 probe exposed retained mmap file handles on shutdown; v1.58.1 uses regular disk I/O and passes the same transfer/restart/cleanup tests without a library fork.

<!-- ponytail: rung 2/3/5 - reuse player, IPA pipeline, Go net/http range serving and anacrolix BT; no new torrent protocol or media decoder. -->

## Contract and state

Flutter is the entry; the embedded Go engine deterministically manages BT and disk data; atomically written task JSON plus saved metainfo/download files are authoritative; signed iPhone installation and playback are the human acceptance gate.

Application Support/TorrentPlayer holds tasks.json, metadata and data partitioned by validated infohash. An add operation deduplicates by infohash. Mutations persist before success; malformed state stops initialization instead of silently replacing it. Pause state survives restart. Metadata is saved so already downloaded files can reopen without finding peers. Engine callbacks surface disk errors and pause the affected task. Only explicit confirmed deletion removes a validated task cache directory.

The local HTTP adapter binds 127.0.0.1 on an ephemeral port, requires a random per-session token, rejects Origin, limits request bodies, and accepts file indices instead of filesystem paths. Native readers use request cancellation and bounded readahead; net/http serves byte ranges. Torrent storage validates untrusted metadata paths. No torrent payload is buffered wholesale in Dart memory. Playback generations prevent an old initialize completion from replacing a newer selection.

## Delivery gates

1. Isolated engine initialization probe on Windows; macOS C archive builds are the iOS ABI risk gate.
2. Meaningful Go tests for auth/boundaries, deduplication, persistent state, pause/delete, HTTP HEAD/ranges and an actual local BT seed-to-reader transfer.
3. Flutter analysis/tests, simulator and device release compilation, unsigned IPA packaging/hash checks.
4. Signing, installation, live public swarm availability, on-device memory and decoding remain separate unverified checks until actually performed.

No cloud account, paid service, desktop backend, automatic upload limit tuning or background execution workaround is needed. Foreground downloading is the initial lifecycle contract; stop the embedded session on app background and restore it on foreground. Source and dependency notices accompany the build.

## Initial risk report

Windows lacks an installed Go/Flutter SDK and macOS/Xcode. An official Go archive was downloaded into runtime and its SHA256 checked. The source-pinned BT library and its path-boundary/reader implementations were inspected. Initial direct Go module downloads timed out; retry through the existing local network proxy. iOS ABI linking, peer transfer and signed-device playback are unverified at design time and must not be reported as passed.

Implementation verification: Windows Go tests pass for authentication/body limits, invalid state preservation, magnet deduplication, persisted pause/resume/delete, a real 2 MiB local peer-to-peer transfer with metadata exchange, HTTP byte ranges/HEAD and offline disk playback after restart. CI additionally runs the engine tests with the race detector, and the simulator integration test calls the real Swift/C/Go bridge. Record actual CI results and artifact paths in apps/mobile/PLAYER.md upon completion.
