"""
Proxy server to forward API requests from port 8001 to Node.js dashboard on port 3001
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DASHBOARD_URL = "http://localhost:3001"
_client = None

def get_client():
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client

@app.on_event("shutdown")
async def shutdown():
    global _client
    if _client:
        await _client.aclose()

@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_api(path: str, request: Request):
    client = get_client()
    url = f"{DASHBOARD_URL}/api/{path}"
    if request.query_params:
        url += f"?{request.query_params}"

    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ['host', 'content-length']}

    response = await client.request(
        method=request.method,
        url=url,
        headers=headers,
        content=body if body else None,
    )

    excluded_headers = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    resp_headers = {k: v for k, v in response.headers.items() if k.lower() not in excluded_headers}

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=resp_headers,
        media_type=response.headers.get('content-type')
    )

@app.get("/health")
async def health():
    return {"status": "ok", "proxy": True}
