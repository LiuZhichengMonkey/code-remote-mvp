// Package engine embeds BT file storage and a private, loopback playback API.
package engine

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

type Record struct {
	ID       string `json:"id"`
	Magnet   string `json:"magnet"`
	Paused   bool   `json:"paused"`
	Deleting bool   `json:"deleting,omitempty"`
}

type task struct {
	Record
	t         *torrent.Torrent
	err       string
	lastBytes int64
	lastTime  time.Time
	rate      int64
}

type Engine struct {
	mu          sync.Mutex
	requests    sync.WaitGroup
	root, token string
	client      *torrent.Client
	disk        storage.ClientImplCloser
	tasks       map[string]*task
	server      *http.Server
	listener    net.Listener
	ctx         context.Context
	cancel      context.CancelFunc
	closed      bool
}

// Start never replaces unreadable/corrupt state. Callers must surface that error.
func Start(root, token string) (*Engine, error) {
	return start(root, token, nil)
}

func start(root, token string, configure func(*torrent.ClientConfig)) (*Engine, error) {
	if len(token) < 32 {
		return nil, errors.New("pairing secret too short")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "data"), 0700); err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "metadata"), 0700); err != nil {
		return nil, err
	}
	var records []Record
	b, err := os.ReadFile(filepath.Join(root, "tasks.json"))
	if err == nil {
		if err = json.Unmarshal(b, &records); err != nil {
			return nil, fmt.Errorf("task state damaged: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if len(records) > 32 {
		return nil, errors.New("too many saved tasks")
	}
	seen := map[string]bool{}
	for _, r := range records {
		m, err := parseMagnet(r.Magnet)
		if err != nil || m.InfoHash.HexString() != r.ID || seen[r.ID] {
			return nil, errors.New("invalid saved task identity")
		}
		seen[r.ID] = true
	}
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir = filepath.Join(root, "data")
	cfg.ListenPort = 0
	cfg.DisableWebtorrent = true
	cfg.EstablishedConnsPerTorrent = 40
	if configure != nil {
		configure(cfg)
	}
	// ponytail: rung 5 - native file storage sanitizes metadata paths and persists pieces.
	disk := storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir: cfg.DataDir,
		TorrentDirMaker: func(base string, _ *metainfo.Info, hash metainfo.Hash) string {
			return filepath.Join(base, hash.HexString())
		},
	})
	cfg.DefaultStorage = disk
	client, err := torrent.NewClient(cfg)
	if err != nil {
		disk.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{root: root, token: token, client: client, disk: disk, tasks: map[string]*task{}, ctx: ctx, cancel: cancel}
	for _, r := range records {
		if _, err = e.attach(r); err != nil {
			e.Close()
			return nil, err
		}
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		e.Close()
		return nil, err
	}
	e.listener = ln
	e.server = &http.Server{Handler: http.HandlerFunc(e.serve), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192,
		BaseContext: func(net.Listener) context.Context { return ctx }}
	go e.server.Serve(ln)
	return e, nil
}

func parseMagnet(raw string) (metainfo.Magnet, error) {
	if len(raw) > 16384 {
		return metainfo.Magnet{}, errors.New("magnet too long")
	}
	return metainfo.ParseMagnetUri(strings.TrimSpace(raw))
}

func (e *Engine) Port() int { return e.listener.Addr().(*net.TCPAddr).Port }

// BackgroundProgress is independent of HTTP/Dart polling. Unknown metadata stays
// pending; paused, deleting and failed tasks must not keep the app awake.
func (e *Engine) BackgroundProgress() (pending int, done, total int64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return
	}
	unknown := false
	for _, x := range e.tasks {
		if x.Paused || x.Deleting || x.err != "" || x.t == nil {
			continue
		}
		if x.t.Info() == nil {
			pending++
			unknown = true
			continue
		}
		size, complete := x.t.Length(), x.t.BytesCompleted()
		total += size
		done += complete
		if complete < size {
			pending++
		}
	}
	if unknown {
		total = -1 // Native Progress uses a negative total for indeterminate work.
	}
	return
}

func atomicWrite(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".pending-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func (e *Engine) persist() error {
	records := make([]Record, 0, len(e.tasks))
	for _, t := range e.tasks {
		records = append(records, t.Record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].ID < records[j].ID })
	b, err := json.Marshal(records)
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(e.root, "tasks.json"), b)
}

// attach is called under e.mu (or before the API starts).
func (e *Engine) attach(r Record) (*task, error) {
	if r.Deleting {
		x := &task{Record: r}
		e.tasks[r.ID] = x
		return x, nil
	}
	var t *torrent.Torrent
	meta, err := metainfo.LoadFromFile(filepath.Join(e.root, "metadata", r.ID+".torrent"))
	if err == nil {
		if meta.HashInfoBytes().HexString() != r.ID {
			return nil, errors.New("saved metadata identity mismatch")
		}
		t, err = e.client.AddTorrent(meta)
	} else if os.IsNotExist(err) {
		t, err = e.client.AddMagnet(r.Magnet)
	}
	if err != nil {
		return nil, err
	}
	x := &task{Record: r, t: t, lastTime: time.Now()}
	e.tasks[r.ID] = x
	if r.Paused {
		t.DisallowDataDownload()
		t.DisallowDataUpload()
	}
	t.SetOnWriteChunkError(func(err error) {
		go func() {
			e.mu.Lock()
			defer e.mu.Unlock()
			if e.closed || e.tasks[r.ID] != x || x.Deleting {
				return
			}
			x.err = "写入缓存失败：" + err.Error()
			x.Paused = true
			t.DisallowDataDownload()
			_ = e.persist()
		}()
	})
	go func() {
		select {
		case <-t.GotInfo():
		case <-e.ctx.Done():
			return
		case <-t.Closed():
			return
		}
		e.mu.Lock()
		defer e.mu.Unlock()
		if e.closed || e.tasks[r.ID] != x {
			return
		}
		mi := t.Metainfo()
		var b bytes.Buffer
		if err := mi.Write(&b); err == nil {
			err = atomicWrite(filepath.Join(e.root, "metadata", r.ID+".torrent"), b.Bytes())
			if err != nil {
				x.err = err.Error()
			}
		}
		t.DownloadAll()
	}()
	return x, nil
}

func (e *Engine) Close() {
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return
	}
	e.closed = true
	e.cancel()
	e.mu.Unlock()
	if e.server != nil {
		e.server.Close()
	}
	e.requests.Wait()
	e.client.Close()
	e.disk.Close()
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, err error) {
	reply(w, status, map[string]string{"error": err.Error()})
}

func (e *Engine) serve(w http.ResponseWriter, r *http.Request) {
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		fail(w, 503, errors.New("engine stopped"))
		return
	}
	e.requests.Add(1)
	e.mu.Unlock()
	defer e.requests.Done()
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("Origin") != "" {
		fail(w, 403, errors.New("browser access denied"))
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if strings.HasPrefix(r.URL.Path, "/stream/") {
		token = r.URL.Query().Get("token")
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(e.token)) != 1 {
		fail(w, 401, errors.New("unauthorized"))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/stream/") {
		e.stream(w, r)
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		fail(w, 503, errors.New("engine stopped"))
		return
	}
	if r.URL.Path == "/api/torrents" && r.Method == "GET" {
		reply(w, 200, e.snapshot())
		return
	}
	if r.URL.Path == "/api/torrents" && r.Method == "POST" {
		var body struct {
			Magnet string `json:"magnet"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 20000)
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&body); err != nil {
			fail(w, 400, err)
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			fail(w, 400, errors.New("unexpected request data"))
			return
		}
		m, err := parseMagnet(body.Magnet)
		if err != nil {
			fail(w, 400, err)
			return
		}
		id := m.InfoHash.HexString()
		if e.tasks[id] != nil {
			reply(w, 200, map[string]string{"id": id})
			return
		}
		if len(e.tasks) >= 32 {
			fail(w, 409, errors.New("最多保留 32 个任务，请先清理"))
			return
		}
		x, err := e.attach(Record{ID: id, Magnet: strings.TrimSpace(body.Magnet)})
		if err != nil {
			fail(w, 400, err)
			return
		}
		if err = e.persist(); err != nil {
			delete(e.tasks, id)
			x.t.Drop()
			fail(w, 500, err)
			return
		}
		reply(w, 200, map[string]string{"id": id})
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/torrents/"), "/")
	if !strings.HasPrefix(r.URL.Path, "/api/torrents/") || len(parts) != 2 || r.Method != "POST" {
		fail(w, 404, errors.New("not found"))
		return
	}
	id, action := parts[0], parts[1]
	x := e.tasks[id]
	if x == nil {
		fail(w, 404, errors.New("task not found"))
		return
	}
	switch action {
	case "pause", "resume":
		if x.Deleting {
			fail(w, 409, errors.New("请重试清理未完成的删除任务"))
			return
		}
		old := x.Paused
		x.Paused = action == "pause"
		if err := e.persist(); err != nil {
			x.Paused = old
			fail(w, 500, err)
			return
		}
		if x.Paused {
			x.t.DisallowDataDownload()
			x.t.DisallowDataUpload()
		} else {
			x.err = ""
			x.t.AllowDataDownload()
			x.t.AllowDataUpload()
		}
	case "delete":
		// Durable tombstone permits retry after interruption or a filesystem failure.
		wasDeleting := x.Deleting
		x.Deleting = true
		if err := e.persist(); err != nil {
			x.Deleting = wasDeleting
			fail(w, 500, err)
			return
		}
		if x.t != nil {
			x.t.Drop()
			x.t = nil
		}
		if err := os.RemoveAll(filepath.Join(e.root, "data", id)); err != nil {
			x.Paused = true
			x.err = err.Error()
			_ = e.persist()
			fail(w, 500, err)
			return
		}
		if err := os.Remove(filepath.Join(e.root, "metadata", id+".torrent")); err != nil && !os.IsNotExist(err) {
			fail(w, 500, err)
			return
		}
		delete(e.tasks, id)
		if err := e.persist(); err != nil {
			e.tasks[id] = x
			fail(w, 500, err)
			return
		}
	default:
		fail(w, 404, errors.New("unknown action"))
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}

func (e *Engine) snapshot() map[string]any {
	items := make([]map[string]any, 0, len(e.tasks))
	for id, x := range e.tasks {
		if x.Deleting {
			items = append(items, map[string]any{"id": id, "name": "删除未完成，请重试删除缓存", "paused": true, "error": x.err, "done": 0, "total": 0, "speed": 0, "peers": 0, "metadata": false, "files": []any{}})
			continue
		}
		t := x.t
		stats := t.Stats()
		now := time.Now()
		read := stats.BytesReadData.Int64()
		if elapsed := now.Sub(x.lastTime).Seconds(); elapsed >= 0.5 {
			x.rate = int64(float64(read-x.lastBytes) / elapsed)
			x.lastBytes = read
			x.lastTime = now
		}
		files := []map[string]any{}
		var total int64
		if t.Info() != nil {
			total = t.Length()
			for i, f := range t.Files() {
				files = append(files, map[string]any{"index": i, "name": f.DisplayPath(), "size": f.Length()})
			}
		}
		items = append(items, map[string]any{"id": id, "name": t.Name(), "paused": x.Paused, "error": x.err, "done": t.BytesCompleted(), "total": total, "speed": x.rate, "peers": stats.ActivePeers, "metadata": t.Info() != nil, "files": files})
	}
	sort.Slice(items, func(i, j int) bool { return items[i]["id"].(string) < items[j]["id"].(string) })
	return map[string]any{"tasks": items, "cachePath": filepath.Join(e.root, "data")}
}

func (e *Engine) stream(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, 405, errors.New("GET or HEAD required"))
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/stream/")
	index, err := strconv.Atoi(r.URL.Query().Get("file"))
	e.mu.Lock()
	x := e.tasks[id]
	if err != nil || x == nil || x.Deleting || x.t.Info() == nil || index < 0 || index >= len(x.t.Files()) {
		e.mu.Unlock()
		fail(w, 404, errors.New("file unavailable"))
		return
	}
	if x.Paused {
		e.mu.Unlock()
		fail(w, 409, errors.New("task paused"))
		return
	}
	f := x.t.Files()[index]
	reader := f.NewReader()
	e.mu.Unlock()
	defer reader.Close()
	reader.SetReadahead(8 * 1024 * 1024)
	// ponytail: rung 3/5 - net/http handles HEAD and seekable byte ranges; BT reader prioritizes requested pieces.
	http.ServeContent(w, r, f.DisplayPath(), time.Time{}, contextReader{reader, r.Context()})
}

type contextReader struct {
	torrent.Reader
	ctx context.Context
}

func (r contextReader) Read(p []byte) (int, error) {
	// Limit a stalled read, not the duration of an otherwise healthy movie stream.
	ctx, cancel := context.WithTimeout(r.ctx, 60*time.Second)
	defer cancel()
	return r.Reader.ReadContext(ctx, p)
}
