import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

load_dotenv()

from app.observability import init_otel, shutdown_otel

init_otel("ai-service")

from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

from app.routes import ai_router, health_router
from app.services.nats_client import close_nats, connect_nats
from app.services.nats_consumer import start_embedding_consumer, stop_embedding_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    HTTPXClientInstrumentor().instrument()
    print("AI Service starting...")
    await connect_nats()
    await start_embedding_consumer()
    yield
    print("AI Service stopping...")
    await stop_embedding_consumer()
    await close_nats()
    shutdown_otel()


app = FastAPI(
    title="KerjaCUS! AI Service",
    version="0.1.0",
    lifespan=lifespan,
)

@app.exception_handler(StarletteHTTPException)
async def _body_parse_error_as_422(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Map Starlette's body-parse 400 to 422 so all input errors share one status code."""
    if exc.status_code == 400 and "parsing the body" in str(exc.detail):
        return JSONResponse(
            status_code=422,
            content={"detail": [{"msg": str(exc.detail), "type": "json_invalid", "loc": ["body"]}]},
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=dict(exc.headers) if exc.headers else None,
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FastAPIInstrumentor.instrument_app(app)

app.include_router(health_router, tags=["health"])
app.include_router(ai_router, prefix="/api/v1/ai", tags=["ai"])
