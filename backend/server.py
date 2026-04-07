"""
Proxy server to forward requests from port 8001 to Node.js dashboard on port 3001
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
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

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy(path: str, request: Request):
    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{DASHBOARD_URL}/{path}"
        if request.query_params:
            url += f"?{request.query_params}"
        
        body = await request.body()
        headers = {k: v for k, v in request.headers.items() if k.lower() not in ['host', 'content-length']}
        
        # Check for SSE
        if 'stream' in path:
            async def stream_response():
                async with client.stream(request.method, url, headers=headers, content=body) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
            return StreamingResponse(stream_response(), media_type='text/event-stream')
        
        response = await client.request(
            method=request.method,
            url=url,
            headers=headers,
            content=body if body else None,
        )
        
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.headers.get('content-type')
        )

@app.get("/")
async def root():
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{DASHBOARD_URL}/")
        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get('content-type', 'text/html')
        )
