import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
