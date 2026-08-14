"""parse-cv must not fetch arbitrary hosts.

/parse-cv is the only route without service auth (tests/test_service_auth.py pins
that deliberately - the browser calls it during talent registration). It also
returns up to 2000 bytes of whatever it downloaded, so before this was fixed an
anonymous caller could make the server read cloud metadata or any internal
service and hand the body back.
"""

import pytest
from fastapi import HTTPException

from app.routes.ai import _resolve_cv_source_url


@pytest.fixture(autouse=True)
def _storage_env(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_BUCKET", "kerjacus-uploads")
    monkeypatch.setenv("S3_PUBLIC_URL", "https://api.kerjacus.id/storage")


class TestResolveCvSourceUrl:
    def test_object_key_resolves_to_bucket(self):
        assert (
            _resolve_cv_source_url("cv/abc-123.pdf")
            == "http://minio:9000/kerjacus-uploads/cv/abc-123.pdf"
        )

    def test_leading_slash_is_tolerated(self):
        assert (
            _resolve_cv_source_url("/cv/abc.pdf") == "http://minio:9000/kerjacus-uploads/cv/abc.pdf"
        )

    @pytest.mark.parametrize(
        "url",
        [
            "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
            "http://localhost:5432/",
            "http://127.0.0.1:8222/varz",
            "https://attacker.example.com/collect",
            "http://project-service:3002/api/v1/projects",
        ],
    )
    def test_foreign_absolute_urls_are_refused(self, url):
        with pytest.raises(HTTPException) as exc:
            _resolve_cv_source_url(url)
        assert exc.value.status_code == 403

    def test_path_traversal_is_refused(self):
        with pytest.raises(HTTPException) as exc:
            _resolve_cv_source_url("../../../etc/passwd")
        assert exc.value.status_code == 403

    def test_empty_is_refused(self):
        with pytest.raises(HTTPException) as exc:
            _resolve_cv_source_url("")
        assert exc.value.status_code == 400

    def test_absolute_url_on_our_storage_is_allowed(self):
        url = "https://api.kerjacus.id/storage/kerjacus-uploads/cv/a.pdf"
        assert _resolve_cv_source_url(url) == url

    def test_internal_s3_endpoint_is_allowed(self):
        url = "http://minio:9000/kerjacus-uploads/cv/a.pdf"
        assert _resolve_cv_source_url(url) == url


class TestParseCvEndpointRefusesSsrf:
    def test_metadata_url_is_rejected_at_the_endpoint(self, client):
        """End to end: the route rejects before any download is attempted."""
        res = client.post(
            "/api/v1/ai/parse-cv",
            json={
                "talent_id": "t-1",
                "file_url": "http://169.254.169.254/latest/meta-data/",
                "file_type": "pdf",
            },
        )
        assert res.status_code == 403
        # And nothing fetched is echoed back.
        assert "meta-data" not in res.text
