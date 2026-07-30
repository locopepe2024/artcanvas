package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
