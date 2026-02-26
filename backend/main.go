package main

import (
	"log"
	"net/http"

	"yt-video-subtitles/backend/config"
	"yt-video-subtitles/backend/handler"
)

func main() {
	// 載入設定
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("設定載入失敗: %v", err)
	}

	// 建立路由多工器
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handler.HealthHandler)
	mux.HandleFunc("/ws", handler.NewWebSocketHandler(cfg))

	// 包裝 CORS 中介層
	corsHandler := enableCORS(mux)

	log.Printf("伺服器啟動於 :%s", cfg.ServerPort)
	if err := http.ListenAndServe(":"+cfg.ServerPort, corsHandler); err != nil {
		log.Fatalf("伺服器啟動失敗: %v", err)
	}
}

// enableCORS 為所有請求加上 CORS 標頭，允許 Chrome Extension 跨域存取
func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		// 預檢請求直接回應
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
