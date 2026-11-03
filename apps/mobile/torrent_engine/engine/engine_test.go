package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

const secret = "0123456789abcdef0123456789abcdef"
const testMagnet = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789"

func offline(c *torrent.ClientConfig) {
	c.NoDHT = true
	c.DisableTrackers = true
	c.NoDefaultPortForwarding = true
	c.DisableIPv6 = true
	c.DisableUTP = true
}
func launch(t *testing.T, root string) *Engine {
	t.Helper()
	e, err := start(root, secret, offline)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	return e
}
func request(t *testing.T, e *Engine, method, path, body string) *http.Response {
	t.Helper()
	r, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", e.Port(), path), strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Authorization", "Bearer "+secret)
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
func body(t *testing.T, r *http.Response) []byte {
	t.Helper()
	defer r.Body.Close()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func add(t *testing.T, e *Engine, magnet string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"magnet": magnet})
	r := request(t, e, "POST", "/api/torrents", string(b))
	data := body(t, r)
	if r.StatusCode != 200 {
		t.Fatalf("add: %s", data)
	}
	var v map[string]string
	_ = json.Unmarshal(data, &v)
	return v["id"]
}

func TestBoundariesAndPersistentTasks(t *testing.T) {
	root := t.TempDir()
	e := launch(t, root)
	r, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/torrents", e.Port()))
	if err != nil {
		t.Fatal(err)
	}
	body(t, r)
	if r.StatusCode != 401 {
		t.Fatal(r.StatusCode)
	}
	req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/api/torrents", e.Port()), nil)
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Origin", "https://example.org")
	r, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body(t, r)
	if r.StatusCode != 403 {
		t.Fatal(r.StatusCode)
	}
	for _, invalid := range []string{`{`, `{"magnet":"https://example.org"}`, `{"magnet":"magnet:?xt=urn:btih:../bad"}`, `{"magnet":"` + strings.Repeat("a", 21000) + `"}`} {
		r = request(t, e, "POST", "/api/torrents", invalid)
		body(t, r)
		if r.StatusCode != 400 {
			t.Fatal(r.StatusCode)
		}
	}
	id := add(t, e, testMagnet)
	if duplicate := add(t, e, testMagnet+"&dn=duplicate"); duplicate != id {
		t.Fatal("duplicate task")
	}
	if len(e.tasks) != 1 {
		t.Fatal("not deduplicated")
	}
	r = request(t, e, "POST", "/api/torrents/"+id+"/pause", "{}")
	body(t, r)
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	e.Close()
	e = launch(t, root)
	if !e.tasks[id].Paused {
		t.Fatal("pause did not survive restart")
	}
	r = request(t, e, "POST", "/api/torrents/"+id+"/resume", "{}")
	body(t, r)
	if r.StatusCode != 200 || e.tasks[id].Paused {
		t.Fatal("resume failed")
	}
	// A sibling outside the per-infohash cache must survive deletion.
	outside := filepath.Join(root, "keep.txt")
	os.WriteFile(outside, []byte("keep"), 0600)
	dir := filepath.Join(root, "data", id)
	os.MkdirAll(dir, 0700)
	os.WriteFile(filepath.Join(dir, "cache"), []byte("video"), 0600)
	r = request(t, e, "POST", "/api/torrents/"+id+"/delete", "{}")
	body(t, r)
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	if _, err = os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("cache remains")
	}
	if _, err = os.Stat(outside); err != nil {
		t.Fatal("unrelated data removed")
	}
	e.Close()
	e = launch(t, root)
	if len(e.tasks) != 0 {
		t.Fatal("deleted task returned")
	}
}

func TestCorruptStateIsPreserved(t *testing.T) {
	for _, data := range []string{`broken`, `[{"id":"../../outside","magnet":"` + testMagnet + `"}]`} {
		root := t.TempDir()
		path := filepath.Join(root, "tasks.json")
		os.WriteFile(path, []byte(data), 0600)
		if e, err := start(root, secret, offline); err == nil {
			e.Close()
			t.Fatal("accepted invalid state")
		}
		got, _ := os.ReadFile(path)
		if string(got) != data {
			t.Fatal("state overwritten")
		}
	}
}

func TestRealPeerTransferRangesAndRestart(t *testing.T) {
	seedRoot := t.TempDir()
	payload := bytes.Repeat([]byte("0123456789abcdef"), 128*1024)
	file := filepath.Join(seedRoot, "sample.mp4")
	if err := os.WriteFile(file, payload, 0600); err != nil {
		t.Fatal(err)
	}
	info := metainfo.Info{PieceLength: 64 * 1024}
	if err := info.BuildFromFilePath(file); err != nil {
		t.Fatal(err)
	}
	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	mi := metainfo.MetaInfo{InfoBytes: infoBytes}
	cfg := torrent.NewDefaultClientConfig()
	offline(cfg)
	cfg.ListenPort = 0
	cfg.DataDir = seedRoot
	cfg.Seed = true
	seed, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer seed.Close()
	seedTorrent, err := seed.AddTorrent(&mi)
	if err != nil {
		t.Fatal(err)
	}
	seedTorrent.VerifyData()
	deadline := time.Now().Add(15 * time.Second)
	for seedTorrent.BytesCompleted() != int64(len(payload)) {
		if time.Now().After(deadline) {
			t.Fatal("seed verification timeout")
		}
		time.Sleep(50 * time.Millisecond)
	}
	root := t.TempDir()
	e := launch(t, root)
	magnet := mi.Magnet(nil, &info).String()
	id := add(t, e, magnet)
	e.tasks[id].t.AddPeers([]torrent.PeerInfo{{Addr: seed.ListenAddrs()[0]}})
	select {
	case <-e.tasks[id].t.GotInfo():
	case <-time.After(15 * time.Second):
		t.Fatal("metadata transfer timeout")
	}
	// Byte-range request starts before the download is required to be complete.
	stream := fmt.Sprintf("/stream/%s?file=0&token=%s", id, url.QueryEscape(secret))
	req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d%s", e.Port(), stream), nil)
	req.Header.Set("Range", "bytes=1000-1999")
	client := &http.Client{Timeout: 20 * time.Second}
	r, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if got := body(t, r); r.StatusCode != 206 || !bytes.Equal(got, payload[1000:2000]) {
		t.Fatalf("range mismatch status %d", r.StatusCode)
	}
	r = request(t, e, "HEAD", stream, "")
	if r.StatusCode != 200 || r.ContentLength != int64(len(payload)) {
		t.Fatalf("HEAD failed %d %d", r.StatusCode, r.ContentLength)
	}
	body(t, r)
	r = request(t, e, "GET", stream, "")
	if got := body(t, r); !bytes.Equal(got, payload) {
		t.Fatal("BT payload differs")
	}
	// A canceled media request must unblock its BT reader.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req, _ = http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("http://127.0.0.1:%d%s", e.Port(), stream), nil)
	if _, err = client.Do(req); err == nil {
		t.Fatal("cancellation ignored")
	}
	deadline = time.Now().Add(10 * time.Second)
	for {
		if _, err = os.Stat(filepath.Join(root, "metadata", id+".torrent")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("metadata not saved")
		}
		time.Sleep(50 * time.Millisecond)
	}
	e.Close()
	seed.Close()
	e = launch(t, root)
	select {
	case <-e.tasks[id].t.GotInfo():
	case <-time.After(5 * time.Second):
		t.Fatal("offline metadata restore failed")
	}
	r = request(t, e, "GET", stream, "")
	if got := body(t, r); !bytes.Equal(got, payload) {
		t.Fatal("offline disk playback differs")
	}
}
