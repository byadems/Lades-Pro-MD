"""
Lades-Pro-MD Dashboard Proxy Backend
Forwards requests to the Node.js dashboard running on port 3001
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, StreamingResponse
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Lades-Pro-MD Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DASHBOARD_URL = "http://localhost:3001"

# Health check
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Lades-Pro-MD Dashboard Proxy"}

# Dashboard info endpoint (must be before proxy catch-all)
@app.get("/api/dashboard/info")
async def dashboard_info():
    return {
        "name": "Lades-Pro-MD",
        "version": "1.0.0",
        "owner_number": "905396978235",
        "features": [
            "WhatsApp Bot Yönetimi",
            "35+ Komut",
            "AI Entegrasyonu",
            "Grup Yönetimi",
            "Anti-Link/Anti-Spam",
            "Zamanlanmış Mesajlar"
        ],
        "status": "ready"
    }

# Proxy all /api/* requests to the Node.js dashboard
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_api(path: str, request: Request):
    """Proxy API requests to the Node.js dashboard"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Build the target URL
            target_url = f"{DASHBOARD_URL}/api/{path}"
            
            # Get query params
            query_params = str(request.query_params)
            if query_params:
                target_url += f"?{query_params}"
            
            # Get request body if present
            body = await request.body()
            
            # Forward the request
            response = await client.request(
                method=request.method,
                url=target_url,
                headers={k: v for k, v in request.headers.items() if k.lower() not in ['host', 'content-length']},
                content=body if body else None,
            )
            
            # Check if it's SSE (Server-Sent Events)
            content_type = response.headers.get('content-type', '')
            
            if 'text/event-stream' in content_type:
                # Stream SSE responses
                async def event_stream():
                    async with httpx.AsyncClient() as stream_client:
                        async with stream_client.stream(
                            method=request.method,
                            url=target_url,
                            headers={k: v for k, v in request.headers.items() if k.lower() not in ['host', 'content-length']},
                        ) as stream_response:
                            async for chunk in stream_response.aiter_bytes():
                                yield chunk
                
                return StreamingResponse(
                    event_stream(),
                    media_type='text/event-stream',
                    headers={
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    }
                )
            
            return JSONResponse(
                content=response.json() if 'application/json' in content_type else {"data": response.text},
                status_code=response.status_code
            )
            
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Dashboard servisi çalışmıyor. Lütfen 'node scripts/dashboard.js' komutunu çalıştırın.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
