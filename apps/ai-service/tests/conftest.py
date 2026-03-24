import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure the ai-service root is on sys.path so `main` is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app


@pytest.fixture()
def client():
    return TestClient(app)
