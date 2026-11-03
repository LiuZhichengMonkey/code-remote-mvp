// stream-fixture is a CI-only local BT seeder for real AVPlayer decoding tests.
package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
	"golang.org/x/time/rate"
)

func main() {
	if len(os.Args) != 3 {
		panic("usage: stream-fixture pattern.mp4 output-directory")
	}
	pattern, err := os.ReadFile(os.Args[1])
	must(err)
	// ponytail: rung 3 - MP4 free padding uses stdlib; no media server or transcoder.
	moov := -1
	for pos := 0; pos+8 <= len(pattern); {
		size := int(binary.BigEndian.Uint32(pattern[pos : pos+4]))
		if size < 8 || pos+size > len(pattern) {
			panic("invalid test MP4")
		}
		if string(pattern[pos+4:pos+8]) == "moov" {
			moov = pos
			break
		}
		pos += size
	}
	if moov < 0 {
		panic("missing moov")
	}
	root, err := filepath.Abs(os.Args[2])
	must(err)
	must(os.MkdirAll(root, 0700))
	path := filepath.Join(root, "pattern.mp4")
	f, err := os.Create(path)
	must(err)
	_, err = f.Write(pattern[:moov])
	must(err)
	const padding = 32 * 1024 * 1024
	header := make([]byte, 8)
	binary.BigEndian.PutUint32(header, padding)
	copy(header[4:], "free")
	_, err = f.Write(header)
	must(err)
	_, err = f.Seek(int64(moov+padding), 0)
	must(err)
	_, err = f.Write(pattern[moov:])
	must(err)
	must(f.Close())
	info := metainfo.Info{PieceLength: 64 * 1024}
	must(info.BuildFromFilePath(path))
	encoded, err := bencode.Marshal(info)
	must(err)
	mi := metainfo.MetaInfo{InfoBytes: encoded}
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir, cfg.ListenPort, cfg.Seed = root, 0, true
	cfg.NoDHT, cfg.DisableTrackers, cfg.DisableUTP = true, true, true
	cfg.DisableIPv6, cfg.NoDefaultPortForwarding = true, true
	cfg.UploadRateLimiter = rate.NewLimiter(256*1024, 64*1024)
	client, err := torrent.NewClient(cfg)
	must(err)
	defer client.Close()
	t, err := client.AddTorrent(&mi)
	must(err)
	t.VerifyData()
	deadline := time.Now().Add(30 * time.Second)
	for t.BytesCompleted() != t.Length() {
		if time.Now().After(deadline) {
			panic("seed verification timed out")
		}
		time.Sleep(50 * time.Millisecond)
	}
	_, port, err := net.SplitHostPort(client.ListenAddrs()[0].String())
	must(err)
	magnet := mi.Magnet(nil, &info).String() + "&x.pe=" + url.QueryEscape(net.JoinHostPort("127.0.0.1", port))
	data, err := json.Marshal(map[string]any{"magnet": magnet})
	must(err)
	must(os.WriteFile(filepath.Join(root, "fixture.json"), data, 0600))
	fmt.Println("Ready: throttled local BT seeder, tail moov, size", t.Length())
	select {}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
