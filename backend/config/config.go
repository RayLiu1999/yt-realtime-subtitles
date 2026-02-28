package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// Config 儲存所有應用程式設定
type Config struct {
	DeepgramAPIKey      string // Deepgram 語音轉文字 API Key（必填）
	GoogleTranslateKey string // Google Translate API Key（選填）
	DeepLAPIKey        string // DeepL API Key（選填）
	ServerPort         string // HTTP 伺服器埠號
	WSToken            string // WebSocket 身分驗證 Token（選填）
}

// Load 從 .env 檔案載入設定，並驗證必要欄位
func Load() (*Config, error) {
	// 嘗試載入 .env，若檔案不存在則忽略（可能已透過環境變數設定）
	_ = godotenv.Load()

	cfg := &Config{
		DeepgramAPIKey:     os.Getenv("DEEPGRAM_API_KEY"),
		GoogleTranslateKey: os.Getenv("GOOGLE_TRANSLATE_API_KEY"),
		DeepLAPIKey:        os.Getenv("DEEPL_API_KEY"),
		ServerPort:         os.Getenv("SERVER_PORT"),
		WSToken:            os.Getenv("WS_AUTH_TOKEN"),
	}

	// 預設埠號
	if cfg.ServerPort == "" {
		cfg.ServerPort = "8080"
	}

	// 驗證必要欄位
	if cfg.DeepgramAPIKey == "" {
		return nil, fmt.Errorf("缺少必要環境變數: DEEPGRAM_API_KEY")
	}

	return cfg, nil
}
