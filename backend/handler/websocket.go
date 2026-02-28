package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"yt-video-subtitles/backend/config"
	"yt-video-subtitles/backend/service"
)

// clientConfig 定義前端傳來的初始化設定
type clientConfig struct {
	Type           string `json:"type"`
	SourceLanguage string `json:"sourceLanguage"`
	TargetLanguage string `json:"targetLanguage"`
	SampleRate     int    `json:"sampleRate"`
}

// subtitleResponse 定義回傳給前端的字幕資料
type subtitleResponse struct {
	Type     string `json:"type"`               // "transcript" | "translation" | "error"
	Text     string `json:"text,omitempty"`     // 辨識或翻譯後的文字
	Original string `json:"original,omitempty"` // 翻譯前的原始文字
	Message  string `json:"message,omitempty"`  // 錯誤描述
}

// upgrader 設定 WebSocket 升級器
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// 預設拒絕所有，只允許指定的白名單
		if origin == "" {
			return true // 允許非瀏覽器連線 (可選，若有 API Token 保護)
		}
		// 允許 YouTube 來源 (Content Script 環境)
		if origin == "https://www.youtube.com" || origin == "https://youtube.com" {
			return true
		}
		log.Printf("拒絕不安全的 Origin: %s", origin)
		return false
	},
}

// NewWebSocketHandler 建立 WebSocket 處理函式
func NewWebSocketHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 驗證 Token (如果環境變數有設定的話)
		token := r.URL.Query().Get("token")
		if cfg.WSToken != "" && token != cfg.WSToken {
			log.Printf("WebSocket 身分驗證失敗: 提供的 Token 不符")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// 升級為 WebSocket 連線
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket 升級失敗: %v", err)
			return
		}
		defer conn.Close()

		log.Println("新的 WebSocket 連線已建立")

		// 等待接收第一則設定訊息
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("讀取設定訊息失敗: %v", err)
			return
		}

		var clientCfg clientConfig
		if err := json.Unmarshal(msg, &clientCfg); err != nil || clientCfg.Type != "config" {
			sendError(conn, "無效的設定格式，預期 type 為 'config'")
			return
		}

		// 驗證設定參數
		if err := validateConfig(clientCfg); err != nil {
			sendError(conn, "設定驗證失敗: "+err.Error())
			return
		}

		log.Printf("收到設定: 來源語言=%s, 目標語言=%s", clientCfg.SourceLanguage, clientCfg.TargetLanguage)

		// 初始化翻譯服務
		translator := service.NewRoundRobinTranslator(cfg.GoogleTranslateKey, cfg.DeepLAPIKey)
		if !translator.Available() {
			sendError(conn, "沒有可用的翻譯服務，請檢查 API Key 設定")
			return
		}

		// 初始化 Deepgram 串流客戶端
		dgClient := service.NewDeepgramClient(cfg.DeepgramAPIKey, clientCfg.SourceLanguage, clientCfg.SampleRate)

		// 設定收到辨識結果時的處理邏輯
		dgClient.SetOnResult(func(transcript string, isFinal bool) {
			if isFinal {
				log.Printf("[STT] 最終辨識: %q", transcript)
			} else {
				// interim 結果不回傳給前端（避免字幕閃爍），只記 debug log
				log.Printf("[STT] 中間辨識: %q", transcript)
				return
			}

			// 註解掉：不先發送原文，避免畫面跳動太頻繁。等翻譯完後一併發送。
			/*
				sendJSON(conn, subtitleResponse{
					Type: "transcript",
					Text: transcript,
				})
			*/

			// 呼叫翻譯 API
			translated, err := translator.Translate(transcript, clientCfg.SourceLanguage, clientCfg.TargetLanguage)
			if err != nil {
				log.Printf("[翻譯] 失敗: %v", err)
				sendError(conn, "翻譯失敗: "+err.Error())
				return
			}

			log.Printf("[翻譯] %q -> %q", transcript, translated)

			sendJSON(conn, subtitleResponse{
				Type:     "translation",
				Text:     translated,
				Original: transcript,
			})
		})

		// 連線至 Deepgram
		if err := dgClient.Connect(); err != nil {
			sendError(conn, "連線 Deepgram 失敗: "+err.Error())
			return
		}
		defer dgClient.Close()

		log.Println("開始接收音訊串流...")

		// 持續接收前端的音訊二進位資料並轉發至 Deepgram
		audioPacketCount := 0
		for {
			// 設定讀取超時（例如 30 秒內沒收到資料就中斷）
			conn.SetReadDeadline(time.Now().Add(30 * time.Second))

			msgType, audioData, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					log.Println("WebSocket 連線正常關閉")
				} else {
					log.Printf("讀取音訊資料失敗: %v", err)
				}
				return
			}

			// 只處理二進位訊息（音訊資料）
			if msgType == websocket.BinaryMessage {
				audioPacketCount++
				if audioPacketCount%50 == 0 {
					log.Printf("[音訊] 已接收 %d 個封包 (%d bytes/包)", audioPacketCount, len(audioData))
				}

				// 轉發至 Deepgram 也要考慮超時嗎？dgClient 內部通常有處理，
				// 這裡主要保護 WebSocket 連線。
				if err := dgClient.Send(audioData); err != nil {
					log.Printf("轉發音訊至 Deepgram 失敗: %v", err)
					sendError(conn, "音訊處理失敗")
					return
				}
			}
		}
	}
}

// validateConfig 驗證客戶端傳來的設定
func validateConfig(cfg clientConfig) error {
	if cfg.SourceLanguage == "" || cfg.TargetLanguage == "" {
		return fmt.Errorf("來源或目標語言不能為空")
	}
	// 簡單的採樣率檢查 (8k - 48k 是常規範圍)
	if cfg.SampleRate < 8000 || cfg.SampleRate > 48000 {
		return fmt.Errorf("無效的採樣率: %d (預期範圍 8000-48000)", cfg.SampleRate)
	}
	return nil
}

// sendJSON 傳送 JSON 格式的回應至前端
func sendJSON(conn *websocket.Conn, data subtitleResponse) {
	msg, err := json.Marshal(data)
	if err != nil {
		log.Printf("序列化回應失敗: %v", err)
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
		log.Printf("傳送回應失敗: %v", err)
	}
}

// sendError 傳送錯誤訊息至前端
func sendError(conn *websocket.Conn, message string) {
	sendJSON(conn, subtitleResponse{
		Type:    "error",
		Message: message,
	})
}
