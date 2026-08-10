package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUploadAndPublicRead(t *testing.T) {
	root := t.TempDir()
	server := newAssetServer(config{root: root, ttl: time.Hour, maxTotalBytes: 1 << 20, uploadsPerHour: 10})
	body, contentType := multipartFile(t, "reference.png", append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 32)...))
	request := httptest.NewRequest(http.MethodPost, "/api/video-assets", body)
	request.Header.Set("Content-Type", contentType)
	request.Host = "canvas.example"
	request.Header.Set("Origin", "https://canvas.example")
	response := httptest.NewRecorder()
	server.upload(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upload status=%d body=%s", response.Code, response.Body.String())
	}
	var uploaded struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &uploaded); err != nil || uploaded.Path == "" {
		t.Fatalf("invalid upload response: %v %s", err, response.Body.String())
	}
	readResponse := httptest.NewRecorder()
	server.read(readResponse, httptest.NewRequest(http.MethodGet, uploaded.Path, nil))
	if readResponse.Code != http.StatusOK || readResponse.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("read status=%d type=%s", readResponse.Code, readResponse.Header().Get("Content-Type"))
	}
}

func TestUploadDetectedWaveAudio(t *testing.T) {
	root := t.TempDir()
	server := newAssetServer(config{root: root, ttl: time.Hour, maxTotalBytes: 1 << 20, uploadsPerHour: 10})
	wave := append([]byte("RIFF"), []byte{36, 0, 0, 0}...)
	wave = append(wave, []byte("WAVEfmt ")...)
	wave = append(wave, bytes.Repeat([]byte{0}, 32)...)
	body, contentType := multipartFile(t, "reference.wav", wave)
	request := httptest.NewRequest(http.MethodPost, "/api/video-assets", body)
	request.Header.Set("Content-Type", contentType)
	request.Host = "canvas.example"
	request.Header.Set("Origin", "https://canvas.example")
	response := httptest.NewRecorder()
	server.upload(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("wave upload status=%d body=%s detected=%s", response.Code, response.Body.String(), http.DetectContentType(wave))
	}
	var payload struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	readRequest := httptest.NewRequest(http.MethodGet, payload.Path, nil)
	readResponse := httptest.NewRecorder()
	server.read(readResponse, readRequest)
	if readResponse.Code != http.StatusOK {
		t.Fatalf("wave read status=%d body=%s", readResponse.Code, readResponse.Body.String())
	}
	if got := readResponse.Header().Get("Content-Type"); got != "audio/wav" {
		t.Fatalf("wave read content-type=%q", got)
	}
}

func TestExpiredAssetReturnsNotFound(t *testing.T) {
	root := t.TempDir()
	id := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
	path := filepath.Join(root, id)
	if err := os.WriteFile(path, []byte("\x89PNG\r\n\x1a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	server := newAssetServer(config{root: root, ttl: time.Hour, maxTotalBytes: 1 << 20, uploadsPerHour: 10})
	response := httptest.NewRecorder()
	server.read(response, httptest.NewRequest(http.MethodGet, "/video-assets/"+id, nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status=%d", response.Code)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expired file was not removed: %v", err)
	}
}

func TestUploadRateLimit(t *testing.T) {
	server := newAssetServer(config{root: t.TempDir(), ttl: time.Hour, maxTotalBytes: 1 << 20, uploadsPerHour: 1})
	if !server.allowUpload("203.0.113.1", time.Now()) || server.allowUpload("203.0.113.1", time.Now()) {
		t.Fatal("rate limit did not close after configured count")
	}
}

func TestAuthenticatedVideoContentProxy(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/videos/task_abc123/content" || r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("Range") != "bytes=0-3" {
			t.Fatalf("unexpected upstream request: path=%s auth=%s range=%s", r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Range"))
		}
		return &http.Response{
			StatusCode: http.StatusPartialContent,
			Header:     http.Header{"Content-Type": {"video/mp4"}, "Content-Range": {"bytes 0-3/8"}},
			Body:       io.NopCloser(strings.NewReader("video")),
			Request:    r,
		}, nil
	})}

	server := newAssetServer(config{root: t.TempDir(), ttl: time.Hour, maxTotalBytes: 1 << 20, uploadsPerHour: 10})
	server.videoContentBaseURL = "https://uniart.test"
	server.videoContentClient = client
	request := httptest.NewRequest(http.MethodGet, "/api/video-content-proxy/task_abc123", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	request.Header.Set("Range", "bytes=0-3")
	response := httptest.NewRecorder()
	server.proxyVideoContent(response, request)
	if response.Code != http.StatusPartialContent || response.Header().Get("Content-Range") != "bytes 0-3/8" || response.Body.String() != "video" {
		t.Fatalf("proxy status=%d range=%s body=%s", response.Code, response.Header().Get("Content-Range"), response.Body.String())
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestVideoRedirectDropsAuthorizationAndRejectsOtherTargets(t *testing.T) {
	client := newVideoContentClient()
	allowed := httptest.NewRequest(http.MethodGet, "https://storage.iyishow.com/uniart-cache/videos/task/result.mp4?sign=x", nil)
	allowed.Header.Set("Authorization", "Bearer secret")
	if err := client.CheckRedirect(allowed, []*http.Request{{}}); err != nil || allowed.Header.Get("Authorization") != "" {
		t.Fatalf("allowed redirect err=%v auth=%q", err, allowed.Header.Get("Authorization"))
	}
	rejected := httptest.NewRequest(http.MethodGet, "https://example.com/uniart-cache/videos/task/result.mp4", nil)
	if err := client.CheckRedirect(rejected, []*http.Request{{}}); err == nil {
		t.Fatal("untrusted redirect target was accepted")
	}
}

func multipartFile(t *testing.T, name string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body, writer.FormDataContentType()
}
