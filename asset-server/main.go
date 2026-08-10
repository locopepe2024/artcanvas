package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	imageMax = int64(30 << 20)
	audioMax = int64(15 << 20)
	videoMax = int64(200 << 20)
	bodyMax  = videoMax + (1 << 20)
)

var assetIDPattern = regexp.MustCompile(`^[0-9a-f]{64}\.(jpg|png|webp|gif|mp4|mov|webm|mp3|wav|m4a)$`)
var videoTaskIDPattern = regexp.MustCompile(`^task_[A-Za-z0-9]+$`)

type config struct {
	root           string
	ttl            time.Duration
	maxTotalBytes  int64
	uploadsPerHour int
}

type rateWindow struct {
	started time.Time
	count   int
}

type assetServer struct {
	config              config
	videoContentBaseURL string
	videoContentClient  *http.Client
	mu                  sync.Mutex
	storageMu           sync.Mutex
	windows             map[string]rateWindow
}

func main() {
	server := newAssetServer(config{
		root:           envString("VIDEO_ASSET_DIR", "/data/video-assets"),
		ttl:            envDuration("VIDEO_ASSET_TTL", 24*time.Hour),
		maxTotalBytes:  envInt64("VIDEO_ASSET_MAX_TOTAL_BYTES", 10<<30),
		uploadsPerHour: envInt("VIDEO_ASSET_UPLOADS_PER_HOUR", 30),
	})
	if err := os.MkdirAll(server.config.root, 0o700); err != nil {
		log.Fatal(err)
	}
	server.cleanup(time.Now())
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for now := range ticker.C {
			server.storageMu.Lock()
			server.cleanup(now)
			server.storageMu.Unlock()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/api/video-assets", server.upload)
	mux.HandleFunc("/api/video-content-proxy/", server.proxyVideoContent)
	mux.HandleFunc("/video-assets/", server.read)
	log.Printf("ArtCanvas asset server listening on 127.0.0.1:3001, root=%s", server.config.root)
	log.Fatal((&http.Server{Addr: "127.0.0.1:3001", Handler: mux, ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 1 << 20}).ListenAndServe())
}

func newAssetServer(value config) *assetServer {
	return &assetServer{config: value, videoContentBaseURL: "https://uniart.fun", videoContentClient: newVideoContentClient(), windows: map[string]rateWindow{}}
}

func (s *assetServer) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *assetServer) upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "cross-origin upload is not allowed")
		return
	}
	if !s.allowUpload(clientIP(r), time.Now()) {
		w.Header().Set("Retry-After", "3600")
		writeError(w, http.StatusTooManyRequests, "upload rate limit exceeded")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, bodyMax)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "file is required or request is too large")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	header, fileHeader, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer header.Close()
	if fileHeader.Size <= 0 {
		writeError(w, http.StatusBadRequest, "file is empty")
		return
	}

	prefix := make([]byte, 512)
	n, err := io.ReadFull(header, prefix)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		writeError(w, http.StatusBadRequest, "read uploaded file failed")
		return
	}
	prefix = prefix[:n]
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(prefix), ";")[0]))
	if contentType == "application/octet-stream" {
		contentType = strings.ToLower(strings.TrimSpace(strings.Split(mime.TypeByExtension(strings.ToLower(filepath.Ext(fileHeader.Filename))), ";")[0]))
	}
	limit, extension, ok := mediaRule(contentType)
	if !ok {
		writeError(w, http.StatusBadRequest, "only supported image, video, and audio files are allowed")
		return
	}
	if fileHeader.Size > limit {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("file exceeds the %d MiB limit", limit>>20))
		return
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	s.cleanup(time.Now())
	used, err := directorySize(s.config.root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "inspect asset storage failed")
		return
	}
	if used+fileHeader.Size > s.config.maxTotalBytes {
		writeError(w, http.StatusInsufficientStorage, "temporary asset storage is full")
		return
	}

	token, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create asset id failed")
		return
	}
	temporary, err := os.CreateTemp(s.config.root, ".upload-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create temporary asset failed")
		return
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	reader := io.MultiReader(bytes.NewReader(prefix), header)
	written, copyErr := io.Copy(temporary, io.LimitReader(reader, limit+1))
	closeErr := temporary.Close()
	if copyErr != nil || closeErr != nil || written <= 0 || written > limit {
		writeError(w, http.StatusBadRequest, "store uploaded file failed")
		return
	}
	id := token + "." + extension
	if err := os.Rename(temporaryPath, filepath.Join(s.config.root, id)); err != nil {
		writeError(w, http.StatusInternalServerError, "finalize uploaded file failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "path": "/video-assets/" + id, "expires_at": time.Now().Add(s.config.ttl).Unix()})
}

func (s *assetServer) read(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/video-assets/")
	if !assetIDPattern.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(filepath.Join(s.config.root, id))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	expiresAt := info.ModTime().Add(s.config.ttl)
	if !expiresAt.After(time.Now()) {
		file.Close()
		os.Remove(filepath.Join(s.config.root, id))
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(id)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", max(0, int(time.Until(expiresAt).Seconds()))))
	http.ServeContent(w, r, id, info.ModTime(), file)
}

func (s *assetServer) proxyVideoContent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	taskID := strings.TrimPrefix(r.URL.Path, "/api/video-content-proxy/")
	if !videoTaskIDPattern.MatchString(taskID) {
		http.NotFound(w, r)
		return
	}
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(authorization, "Bearer ") || strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer ")) == "" {
		writeError(w, http.StatusUnauthorized, "authorization is required")
		return
	}
	upstreamURL := strings.TrimRight(s.videoContentBaseURL, "/") + "/v1/videos/" + taskID + "/content"
	request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prepare video download failed")
		return
	}
	request.Header.Set("Authorization", authorization)
	for _, name := range []string{"Range", "If-Range"} {
		if value := r.Header.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	response, err := s.videoContentClient.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "download video failed")
		return
	}
	defer response.Body.Close()
	for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control"} {
		if value := response.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(response.StatusCode)
	if r.Method != http.MethodHead {
		io.Copy(w, response.Body)
	}
}

func newVideoContentClient() *http.Client {
	return &http.Client{
		Timeout: 130 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) > 3 {
				return errors.New("too many video redirects")
			}
			if request.URL.Scheme != "https" || !strings.EqualFold(request.URL.Hostname(), "storage.iyishow.com") || !strings.HasPrefix(request.URL.Path, "/uniart-cache/videos/") {
				return errors.New("video redirect target is not allowed")
			}
			request.Header.Del("Authorization")
			return nil
		},
	}
}

func (s *assetServer) allowUpload(ip string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.windows) > 1000 {
		for key, value := range s.windows {
			if now.Sub(value.started) >= time.Hour {
				delete(s.windows, key)
			}
		}
	}
	window := s.windows[ip]
	if window.started.IsZero() || now.Sub(window.started) >= time.Hour {
		window = rateWindow{started: now}
	}
	if window.count >= s.config.uploadsPerHour {
		return false
	}
	window.count++
	s.windows[ip] = window
	return true
}

func (s *assetServer) cleanup(now time.Time) {
	filepath.WalkDir(s.config.root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		info, statErr := entry.Info()
		if statErr == nil && ((strings.HasPrefix(entry.Name(), ".upload-") && info.ModTime().Add(time.Hour).Before(now)) || !info.ModTime().Add(s.config.ttl).After(now)) {
			os.Remove(path)
		}
		return nil
	})
}

func mediaRule(contentType string) (int64, string, bool) {
	rules := map[string]struct {
		limit int64
		ext   string
	}{
		"image/jpeg": {imageMax, "jpg"}, "image/png": {imageMax, "png"}, "image/webp": {imageMax, "webp"}, "image/gif": {imageMax, "gif"},
		"video/mp4": {videoMax, "mp4"}, "video/quicktime": {videoMax, "mov"}, "video/webm": {videoMax, "webm"},
		"audio/mpeg": {audioMax, "mp3"}, "audio/wav": {audioMax, "wav"}, "audio/wave": {audioMax, "wav"}, "audio/x-wav": {audioMax, "wav"}, "audio/vnd.wave": {audioMax, "wav"}, "audio/mp4": {audioMax, "m4a"}, "audio/x-m4a": {audioMax, "m4a"},
	}
	rule, ok := rules[contentType]
	return rule.limit, rule.ext, ok
}

func sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && strings.EqualFold(parsed.Host, r.Host)
}

func clientIP(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if host == "127.0.0.1" || host == "::1" {
		forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for index := len(forwarded) - 1; index >= 0; index-- {
			candidate := net.ParseIP(strings.TrimSpace(forwarded[index]))
			if candidate != nil && !candidate.IsPrivate() && !candidate.IsLoopback() {
				return candidate.String()
			}
		}
		if realIP := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); realIP != nil {
			return realIP.String()
		}
	}
	if host != "" {
		return host
	}
	return r.RemoteAddr
}

func directorySize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			total += info.Size()
		}
		return nil
	})
	return total, err
}

func randomToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": message, "type": "invalid_request_error"}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func envString(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(envString(key, fallback.String()))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(envString(key, strconv.FormatInt(fallback, 10)), 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(envString(key, strconv.Itoa(fallback)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
