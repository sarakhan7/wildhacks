from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from urllib import error, parse, request


@dataclass(frozen=True)
class StoredUpload:
    local_path: Path
    storage_provider: str
    storage_bucket: str | None = None
    storage_object_path: str | None = None
    storage_url: str | None = None
    warnings: list[str] = field(default_factory=list)


class DocumentStorageService:
    def __init__(
        self,
        *,
        upload_dir: Path,
        supabase_url: str = "",
        supabase_publishable_key: str = "",
        supabase_service_role_key: str = "",
        supabase_storage_bucket: str = "audit-documents",
    ) -> None:
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_publishable_key = supabase_publishable_key
        self.supabase_service_role_key = supabase_service_role_key
        self.supabase_storage_bucket = supabase_storage_bucket

    def store_bytes(self, *, audit_id: str, document_id: str, filename: str, mime_type: str, content: bytes) -> StoredUpload:
        destination_dir = self.upload_dir / audit_id
        destination_dir.mkdir(parents=True, exist_ok=True)
        local_path = destination_dir / f"{document_id}-{filename}"
        local_path.write_bytes(content)

        if not self.supabase_url or not self._auth_token:
            return StoredUpload(local_path=local_path, storage_provider="local")

        object_path = f"{audit_id}/{document_id}-{filename}"
        warnings: list[str] = []
        try:
            self._upload_to_supabase(object_path=object_path, mime_type=mime_type, content=content)
            return StoredUpload(
                local_path=local_path,
                storage_provider="supabase",
                storage_bucket=self.supabase_storage_bucket,
                storage_object_path=object_path,
                storage_url=self._public_object_url(object_path),
            )
        except Exception as exc:
            warnings.append(f"Supabase upload failed; local copy retained. {exc}")
            return StoredUpload(
                local_path=local_path,
                storage_provider="local",
                storage_bucket=self.supabase_storage_bucket,
                storage_object_path=object_path,
                warnings=warnings,
            )

    def _upload_to_supabase(self, *, object_path: str, mime_type: str, content: bytes) -> None:
        encoded_path = "/".join(parse.quote(part, safe="") for part in object_path.split("/"))
        upload_url = f"{self.supabase_url}/storage/v1/object/{self.supabase_storage_bucket}/{encoded_path}"
        headers = {
            "apikey": self._auth_token,
            "Authorization": f"Bearer {self._auth_token}",
            "Content-Type": mime_type or "application/octet-stream",
            "x-upsert": "true",
        }
        req = request.Request(upload_url, method="POST", data=content, headers=headers)
        try:
            with request.urlopen(req, timeout=60) as response:
                if response.status not in {200, 201}:
                    raise RuntimeError(f"Unexpected Supabase Storage response: {response.status}")
        except error.HTTPError as exc:
            raise RuntimeError(exc.read().decode("utf-8")) from exc

    def _public_object_url(self, object_path: str) -> str:
        encoded_path = "/".join(parse.quote(part, safe="") for part in object_path.split("/"))
        return f"{self.supabase_url}/storage/v1/object/public/{self.supabase_storage_bucket}/{encoded_path}"

    @property
    def _auth_token(self) -> str:
        return self.supabase_service_role_key or self.supabase_publishable_key
