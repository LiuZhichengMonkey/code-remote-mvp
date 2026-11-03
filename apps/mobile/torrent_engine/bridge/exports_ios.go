//go:build ios

package main

import "C"
import (
	"coderemote/torrentengine/engine"
	"fmt"
	"os"
	"runtime/debug"
	"sync"
)

var bridgeMu sync.Mutex
var session *engine.Engine

//export TorrentStart
func TorrentStart(path, token *C.char) C.int {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	if session != nil {
		return C.int(session.Port())
	}
	// A soft Go heap target, not a total-process memory cap. Payload lives on disk.
	debug.SetMemoryLimit(128 * 1024 * 1024)
	e, err := engine.Start(C.GoString(path), C.GoString(token))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Torrent engine initialization failed:", err)
		return -1
	}
	session = e
	return C.int(e.Port())
}

//export TorrentStop
func TorrentStop() {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	if session != nil {
		session.Close()
		session = nil
	}
}
