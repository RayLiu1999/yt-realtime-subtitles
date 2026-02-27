FROM golang:1.25-alpine AS builder

WORKDIR /app

# 設定環境變數以使用 Go Modules 並靜態編譯
ENV GO111MODULE=on \
    CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64

# 首先複製 go.mod 與 go.sum 並下載依賴 (利用 Docker 快取機制)
COPY go.mod go.sum ./
RUN go mod download

# 複製所有程式碼
COPY . .

# 編譯 Go 執行檔，去除除錯資訊以縮小體積
RUN go build -ldflags="-s -w" -o main .

# ==============================================================
# 第二階段: 使用極小化的 scratch 映像檔來執行
FROM alpine:latest

WORKDIR /app

# 安裝根憑證 (用以正確發送 HTTPS 請求給 Deepgram, Google 等 API)
RUN apk --no-cache add ca-certificates

# 從 Builder 階段複製編譯好的執行檔
COPY --from=builder /app/main .

# 曝露預設通訊埠
EXPOSE 8080

# 啟動應用程式
CMD ["./main"]
