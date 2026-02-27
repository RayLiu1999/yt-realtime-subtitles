package service

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// DeepgramResult 表示 Deepgram 回傳的語音辨識結果
type DeepgramResult struct {
	Type    string `json:"type"`
	Channel struct {
		Alternatives []struct {
			Transcript string  `json:"transcript"`
			Confidence float64 `json:"confidence"`
		} `json:"alternatives"`
	} `json:"channel"`
	IsFinal bool `json:"is_final"`
}

// DeepgramClient 管理與 Deepgram Streaming API 的 WebSocket 連線
type DeepgramClient struct {
	conn       *websocket.Conn
	apiKey     string
	language   string
	sampleRate int
	onResult   func(transcript string, isFinal bool)
	mu         sync.Mutex
	done       chan struct{}
}

// NewDeepgramClient 建立新的 Deepgram 串流客戶端
func NewDeepgramClient(apiKey, language string, sampleRate int) *DeepgramClient {
	if sampleRate == 0 {
		sampleRate = 16000
	}
	return &DeepgramClient{
		apiKey:     apiKey,
		language:   language,
		sampleRate: sampleRate,
		done:       make(chan struct{}),
	}
}

// SetOnResult 設定收到辨識結果時的回呼函式
func (d *DeepgramClient) SetOnResult(callback func(transcript string, isFinal bool)) {
	d.onResult = callback
}

// Connect 連線至 Deepgram Streaming API
func (d *DeepgramClient) Connect() error {
	// 組建 Deepgram WebSocket URL，設定語言、模型與編碼格式，動態代入取樣率
	url := fmt.Sprintf(
		"wss://api.deepgram.com/v1/listen?language=%s&model=nova-2&encoding=linear16&sample_rate=%d&channels=1&punctuate=true&interim_results=true",
		d.language, d.sampleRate,
	)

	header := make(map[string][]string)
	header["Authorization"] = []string{"Token " + d.apiKey}

	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		return fmt.Errorf("連線 Deepgram 失敗: %w", err)
	}

	d.conn = conn
	log.Printf("已連線至 Deepgram（語言: %s）", d.language)

	// 啟動背景 goroutine 接收辨識結果
	go d.readResults()

	return nil
}

// Send 傳送音訊二進位資料至 Deepgram
func (d *DeepgramClient) Send(audioData []byte) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.conn == nil {
		return fmt.Errorf("尚未連線至 Deepgram")
	}

	return d.conn.WriteMessage(websocket.BinaryMessage, audioData)
}

// Close 關閉與 Deepgram 的連線
func (d *DeepgramClient) Close() {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.conn != nil {
		// 傳送關閉串流的 JSON 訊息
		closeMsg, _ := json.Marshal(map[string]string{"type": "CloseStream"})
		d.conn.WriteMessage(websocket.TextMessage, closeMsg)
		d.conn.Close()
		d.conn = nil
	}

	close(d.done)
}

// readResults 持續讀取 Deepgram 回傳的辨識結果
func (d *DeepgramClient) readResults() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Deepgram 讀取 goroutine 發生 panic: %v", r)
		}
	}()

	for {
		select {
		case <-d.done:
			return
		default:
			_, message, err := d.conn.ReadMessage()
			if err != nil {
				// log.Printf("讀取 Deepgram 訊息失敗: %v", err)
				return
			}

			var result DeepgramResult
			if err := json.Unmarshal(message, &result); err != nil {
				// log.Printf("解析 Deepgram 結果失敗: %v", err)
				continue
			}

			// 取得最佳辨識結果
			if len(result.Channel.Alternatives) > 0 {
				transcript := result.Channel.Alternatives[0].Transcript
				if transcript != "" && d.onResult != nil {
					d.onResult(transcript, result.IsFinal)
				}
			}
		}
	}
}
