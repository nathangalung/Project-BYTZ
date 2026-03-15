import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.routes import ai_router, health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("AI Service starting up...")
    yield
    # Shutdown
    print("AI Service shutting down...")


app = FastAPI(
    title="BYTZ AI Service",
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

app.include_router(health_router, tags=["health"])
app.include_router(ai_router, prefix="/api/v1/ai", tags=["ai"])
