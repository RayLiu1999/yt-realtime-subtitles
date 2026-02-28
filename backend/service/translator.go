package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync/atomic"
	"time"
)

// Translator 定義翻譯服務介面
type Translator interface {
	Translate(text, sourceLang, targetLang string) (string, error)
	Name() string
}

// RoundRobinTranslator 以輪流方式在多個翻譯服務之間切換
type RoundRobinTranslator struct {
	translators []Translator
	counter     atomic.Uint64
}

// NewRoundRobinTranslator 建立 Round-Robin 翻譯器
// 根據提供的 API Key 自動註冊可用的翻譯服務
func NewRoundRobinTranslator(googleKey, deeplKey string) *RoundRobinTranslator {
	rr := &RoundRobinTranslator{}

	if googleKey != "" {
		rr.translators = append(rr.translators, &GoogleTranslator{apiKey: googleKey})
		log.Println("已註冊翻譯服務: Google Translate")
	}

	if deeplKey != "" {
		rr.translators = append(rr.translators, &DeepLTranslator{apiKey: deeplKey})
		log.Println("已註冊翻譯服務: DeepL")
	}

	return rr
}

// Available 檢查是否有可用的翻譯服務
func (rr *RoundRobinTranslator) Available() bool {
	return len(rr.translators) > 0
}

// Translate 執行翻譯，目前改為優先使用 Google，失敗才使用其他備援服務
func (rr *RoundRobinTranslator) Translate(text, sourceLang, targetLang string) (string, error) {
	if len(rr.translators) == 0 {
		return "", fmt.Errorf("沒有可用的翻譯服務")
	}

	total := len(rr.translators)
	// 如果同時有 Google 和 DeepL，這裡固定優先從 Google (index 0) 開始嘗試
	// 如果只有一個服務，idx 也會是 0
	idx := 0

	// 嘗試所有翻譯服務
	for i := 0; i < total; i++ {
		current := (idx + i) % total
		translator := rr.translators[current]

		start := time.Now()
		result, err := translator.Translate(text, sourceLang, targetLang)
		duration := time.Since(start)

		if err == nil {
			log.Printf("[%s] 翻譯完成，耗時: %v", translator.Name(), duration)
			return result, nil
		}

		log.Printf("[%s] 翻譯失敗: %v，耗時: %v，嘗試下一個服務", translator.Name(), err, duration)
	}

	return "", fmt.Errorf("所有翻譯服務皆失敗")
}

// === Google Translate ===

// GoogleTranslator 使用 Google Cloud Translation API
type GoogleTranslator struct {
	apiKey string
}

func (g *GoogleTranslator) Name() string { return "Google Translate" }

func (g *GoogleTranslator) Translate(text, sourceLang, targetLang string) (string, error) {
	endpoint := "https://translation.googleapis.com/language/translate/v2"

	params := url.Values{}
	params.Set("q", text)
	params.Set("source", sourceLang)
	params.Set("target", targetLang)
	params.Set("key", g.apiKey)
	params.Set("format", "text")

	resp, err := http.Get(endpoint + "?" + params.Encode())
	if err != nil {
		return "", fmt.Errorf("Google Translate 請求失敗: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Google Translate 回應錯誤 (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data struct {
			Translations []struct {
				TranslatedText string `json:"translatedText"`
			} `json:"translations"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析 Google Translate 回應失敗: %w", err)
	}

	if len(result.Data.Translations) == 0 {
		return "", fmt.Errorf("Google Translate 未回傳翻譯結果")
	}

	return result.Data.Translations[0].TranslatedText, nil
}

// === DeepL ===

// DeepLTranslator 使用 DeepL API
type DeepLTranslator struct {
	apiKey string
}

func (d *DeepLTranslator) Name() string { return "DeepL" }

func (d *DeepLTranslator) Translate(text, sourceLang, targetLang string) (string, error) {
	endpoint := "https://api-free.deepl.com/v2/translate"

	// DeepL 使用大寫語言代碼，且繁體中文為 ZH-HANT
	deeplTarget := mapToDeepLLang(targetLang)
	deeplSource := mapToDeepLLang(sourceLang)

	reqBody := map[string]interface{}{
		"text":        []string{text},
		"target_lang": deeplTarget,
	}

	// DeepL 的 source_lang 為選填
	if deeplSource != "" {
		reqBody["source_lang"] = deeplSource
	}

	bodyBytes, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("建立 DeepL 請求失敗: %w", err)
	}

	req.Header.Set("Authorization", "DeepL-Auth-Key "+d.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("DeepL 請求失敗: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("DeepL 回應錯誤 (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Translations []struct {
			Text string `json:"text"`
		} `json:"translations"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析 DeepL 回應失敗: %w", err)
	}

	if len(result.Translations) == 0 {
		return "", fmt.Errorf("DeepL 未回傳翻譯結果")
	}

	return result.Translations[0].Text, nil
}

// mapToDeepLLang 將通用語言代碼轉換為 DeepL 使用的格式
func mapToDeepLLang(lang string) string {
	mapping := map[string]string{
		"zh-TW": "ZH-HANT",
		"zh-CN": "ZH-HANS",
		"zh":    "ZH-HANS",
		"en":    "EN",
		"ja":    "JA",
		"id":    "ID",
		"ko":    "KO",
		"es":    "ES",
		"fr":    "FR",
		"de":    "DE",
		"pt":    "PT-BR",
		"ru":    "RU",
	}

	if mapped, ok := mapping[lang]; ok {
		return mapped
	}

	// 嘗試直接使用大寫
	return fmt.Sprintf("%s", lang)
}
