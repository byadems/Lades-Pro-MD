"""
Proxy server to forward API requests from port 8001 to Node.js dashboard on port 3001
"""
from typing import Optional

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

DASHBOARD_URL: str = "http://localhost:3001"
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


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_api(path: str, request: Request) -> Response:
    client = get_client()
    url = f"{DASHBOARD_URL}/api/{path}"
    if request.query_params:
        url += f"?{request.query_params}"

    body: bytes = await request.body()
    headers: dict[str, str] = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ['host', 'content-length']
    }

    response = await client.request(
        method=request.method,
        url=url,
        headers=headers,
        content=body if body else None,
    )

    excluded_headers = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    resp_headers: dict[str, str] = {
        k: v for k, v in response.headers.items()
        if k.lower() not in excluded_headers
    }

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=resp_headers,
        media_type=response.headers.get('content-type'),
    )


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "proxy": True}
