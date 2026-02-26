package handler

import (
	"encoding/json"
	"net/http"
)

// healthResponse 定義健康檢查回應格式
type healthResponse struct {
	Status string `json:"status"`
}

// HealthHandler 處理 GET /health 請求，回傳伺服器健康狀態
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "僅支援 GET 方法", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(healthResponse{Status: "ok"})
}
