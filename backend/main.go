package main

import (
	"log"
	"net"
	"net/http"
	"strings"
	"sync"

	"yt-video-subtitles/backend/config"
	"yt-video-subtitles/backend/handler"
)

var (
	// 每 IP 同時連線限制
	activeConns    = make(map[string]int)
	activeConnsMux sync.Mutex
	maxConnsPerIP  = 3
)

func main() {
	// ... existing load config ...
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("設定載入失敗: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handler.HealthHandler)

	// WebSocket 路由加上限制
	mux.HandleFunc("/ws", limitRate(handler.NewWebSocketHandler(cfg)))

	corsHandler := enableCORS(mux)

	log.Printf("伺服器啟動於 :%s", cfg.ServerPort)
	if err := http.ListenAndServe(":"+cfg.ServerPort, corsHandler); err != nil {
		log.Fatalf("伺服器啟動失敗: %v", err)
	}
}

// limitRate 限制每個 IP 的同時連線數
func limitRate(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := getIP(r)

		activeConnsMux.Lock()
		if activeConns[ip] >= maxConnsPerIP {
			activeConnsMux.Unlock()
			log.Printf("拒絕來自 %s 的連線: 已達最大限制", ip)
			http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
			return
		}
		activeConns[ip]++
		activeConnsMux.Unlock()

		// 這裡是中介層，但因為 WebSocket 是長連線且 defer 在 handler 內，
		// 我們需要一個方法來在連線結束時回收。
		// 為了簡化，目前的設計讓 handler 本身負責回報結束，
		// 但更穩健的做法是把連線計數器放在 Handler 的 Context 中。
		// 這裡採取簡易做法：用一個 wrapper。
		defer func() {
			activeConnsMux.Lock()
			activeConns[ip]--
			if activeConns[ip] <= 0 {
				delete(activeConns, ip)
			}
			activeConnsMux.Unlock()
		}()

		next.ServeHTTP(w, r)
	}
}

func getIP(r *http.Request) string {
	// 考慮代理伺服器 (X-Forwarded-For)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.Split(xff, ",")[0]
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}

// enableCORS 僅允許 Chrome Extension 來源
func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// 僅允許 YouTube 跨域請求
		if origin == "https://www.youtube.com" || origin == "https://youtube.com" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			// 非法來源不給 Access-Control-Allow-Origin
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
