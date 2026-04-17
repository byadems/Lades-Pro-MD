"""
Proxy server + AI endpoint: forwards API requests to Node.js dashboard on port 3001,
handles AI command generation directly via Gemini 3 Flash.
"""
import os
import re
import uuid
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import httpx

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DASHBOARD_URL: str = "http://localhost:3001"
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")

_client: Optional[httpx.AsyncClient] = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


@app.on_event("shutdown")
async def shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ═══════════════════════════════════════
#  AI KOMUT FABRİKASI (Gemini 3 Flash)
# ═══════════════════════════════════════

SYSTEM_PROMPT = """Sen bir WhatsApp bot komut geliştiricisisin. Lades-Pro bot yapısında çalışan Node.js eklentileri yazıyorsun.

Kural: Bot yapısında Module() fonksiyonu ile komutlar oluşturulur. Tüm çıktılar SADECE Türkçe olmalı. Kesinlikle İngilizce kelime kullanma.

Örnek yapı:
const { Module } = require("../main");
const axios = require("axios");

Module({
  pattern: "komutadi ?(.*)",
  fromMe: false,
  desc: "Komut açıklaması Türkçe",
  usage: ".komutadi [parametre]",
  use: "kategori",
}, async (message, match) => {
  const input = (match[1] || "").trim();
  // Komut mantığı
  await message.sendReply("Türkçe yanıt");
});

message nesnesi şu metodlara sahip:
- message.sendReply(text) - Metin yanıtı
- message.client.sendMessage(jid, content, options) - Dosya/görsel/video gönderme
- message.jid - Mevcut sohbet ID'si
- message.sender - Gönderen kişi
- message.pushName - Kullanıcı adı
- message.reply_message - Yanıtlanan mesaj (varsa .text ile metni alınır)
- message.data - Ham mesaj verisi
- message.isGroup - Grup mu?

Kullanabilirsin: axios, fs, path, os, Buffer

SADECE çalışan, hatasız JavaScript kodu üret. Açıklama yazma, yorum ekleme, sadece kodu ver."""


class AIGenerateRequest(BaseModel):
    description: str
    model: str = "gemini-3-flash-preview"


@app.post("/api/ai/generate-command")
async def ai_generate_command(req: AIGenerateRequest) -> dict:
    if not req.description.strip():
        return {"error": "Komut açıklaması gerekli"}

    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY yapılandırılmamış!"}

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{req.model}:generateContent?key={GEMINI_API_KEY}"
        
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": f"System: {SYSTEM_PROMPT}"}]
                },
                {
                    "role": "user",
                    "parts": [{"text": f"Şu işlevi yapan bir bot komutu oluştur: {req.description}"}]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "topP": 0.8,
                "topK": 40,
                "maxOutputTokens": 2048,
            }
        }

        client = get_client()
        res = await client.post(url, json=payload, timeout=60.0)
        
        if res.status_code != 200:
            return {"error": f"Gemini API Hatası ({res.status_code}): {res.text}"}
            
        data = res.json()
        
        if "candidates" not in data or not data["candidates"]:
            return {"error": "Gemini uygun bir yanıt üretmedi."}
            
        response_text = data["candidates"][0]["content"]["parts"][0]["text"]

        code_match = re.search(r"```(?:javascript|js)?\n?([\s\S]*?)```", response_text)
        code = code_match.group(1).strip() if code_match else response_text.strip()

        return {"success": True, "code": code, "model": "gemini-3-flash"}

    except Exception as e:
        return {"success": False, "error": str(e)}


class AISaveRequest(BaseModel):
    code: str
    name: str


@app.post("/api/ai/save-command")
async def ai_save_command(req: AISaveRequest) -> dict:
    if not req.code or not req.name:
        return {"error": "Kod ve isim gerekli"}

    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "", req.name.lower())
    file_name = f"ai-{safe_name}.js"
    file_path = os.path.join(os.path.dirname(__file__), "..", "plugins", file_name)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(req.code)
        return {
            "success": True,
            "fileName": file_name,
            "message": f"Komut {file_name} olarak kaydedildi. Bot yeniden başlatıldığında aktif olacak.",
        }
    except Exception as e:
        return {"error": str(e)}


# ═══════════════════════════════════════
#  PROXY (diğer tüm /api/* istekleri)
# ═══════════════════════════════════════

@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy_api(path: str, request: Request) -> Response:
    # AI endpoints are handled directly above, skip proxy
    if path.startswith("ai/"):
        return Response(content='{"error":"Not found"}', status_code=404, media_type="application/json")

    # SSE stream endpoints - use streaming response
    if "stream" in path or "log" in path:
        async def stream_response():
            async with httpx.AsyncClient(timeout=None) as stream_client:
                async with stream_client.stream(
                    request.method, url, headers=headers, content=body if body else None
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    client = get_client()
    url = f"{DASHBOARD_URL}/api/{path}"
    if request.query_params:
        url += f"?{request.query_params}"

    body: bytes = await request.body()
    headers: dict[str, str] = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ["host", "content-length"]
    }

    response = await client.request(
        method=request.method,
        url=url,
        headers=headers,
        content=body if body else None,
    )

    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    resp_headers: dict[str, str] = {
        k: v for k, v in response.headers.items() if k.lower() not in excluded
    }

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=resp_headers,
        media_type=response.headers.get("content-type"),
    )


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "proxy": True}
