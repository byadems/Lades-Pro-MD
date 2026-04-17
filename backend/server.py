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
EMERGENT_LLM_KEY: str = os.environ.get("EMERGENT_LLM_KEY", "")

_client: Optional[httpx.AsyncClient] = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0)
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
Ücretsiz API: https://api.siputzx.my.id (anahtar gerektirmez)
Siputzx AI: /api/ai/duckai?message=... | /api/ai/deepseekr1?prompt=...
Siputzx Arama: /api/s/pinterest?query=... | /api/s/googleimg?query=...
Siputzx İndirme: /api/d/tiktok?url=... | /api/d/facebook?url=...
Siputzx Araçlar: /api/tools/translate?text=...&to=tr | /api/tools/ssweb?url=...

SADECE çalışan, hatasız JavaScript kodu üret. Açıklama yazma, yorum ekleme, sadece kodu ver."""


class AIGenerateRequest(BaseModel):
    description: str
    model: str = "gemini-3-flash-preview"


@app.post("/api/ai/generate-command")
async def ai_generate_command(req: AIGenerateRequest) -> dict:
    if not req.description.strip():
        return {"error": "Komut açıklaması gerekli"}

    if not EMERGENT_LLM_KEY:
        return {"error": "EMERGENT_LLM_KEY yapılandırılmamış."}

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ai-cmd-{uuid.uuid4().hex[:8]}",
            system_message=SYSTEM_PROMPT,
        ).with_model("gemini", "gemini-3-flash-preview")

        user_msg = UserMessage(
            text=f"Şu işlevi yapan bir bot komutu oluştur: {req.description}"
        )

        response = await chat.send_message(user_msg)

        if not response:
            return {"error": "Gemini yanıt vermedi."}

        code_match = re.search(r"```(?:javascript|js)?\n?([\s\S]*?)```", response)
        code = code_match.group(1).strip() if code_match else response.strip()

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
