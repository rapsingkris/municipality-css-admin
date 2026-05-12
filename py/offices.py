"""
offices.py
──────────────────────────────────────────────────────────────
Server-side helper module for managing offices in Supabase.

Covers:
  • Schema definition / migration SQL
  • Supabase Storage bucket creation
  • CRUD helpers (create, read, update, delete)
  • Image upload utility

Dependencies:
    pip install supabase python-dotenv

Environment variables (put in a .env file):
    SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
    SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY          # use service role for server-side ops
──────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import os
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# ── Supabase client ────────────────────────────────────────
SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_KEY: str = os.environ["SUPABASE_KEY"]   # service-role key for server use

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Constants ──────────────────────────────────────────────
TABLE        = "offices"
BUCKET       = "office-photos"
PHOTO_PREFIX = "offices"   # folder path inside the bucket


# ══════════════════════════════════════════════════════════
#  SCHEMA SQL
#  Run this once against your Supabase project (SQL Editor
#  or a migration tool such as Flyway / Alembic).
# ══════════════════════════════════════════════════════════

SCHEMA_SQL = """
-- ── Enable UUID extension (already on by default in Supabase) ──
create extension if not exists "uuid-ossp";

-- ── offices table ──────────────────────────────────────────────
create table if not exists public.offices (
    id          uuid        primary key default uuid_generate_v4(),
    name        text        not null,
    photo_url   text,                            -- public URL from Supabase Storage
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ── Automatically update updated_at on every row change ────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_offices_updated_at on public.offices;
create trigger trg_offices_updated_at
    before update on public.offices
    for each row execute function public.set_updated_at();

-- ── Row-Level Security ──────────────────────────────────────────
alter table public.offices enable row level security;

-- Allow all authenticated users to read offices
create policy "Offices are viewable by authenticated users"
    on public.offices for select
    using ( auth.role() = 'authenticated' );

-- Only service-role (admin) can insert / update / delete
-- (Handled server-side via service-role key — no additional policy needed.)

-- ── Storage bucket (run via Supabase dashboard or Management API) ─
-- The bucket is created programmatically in ensure_bucket() below.
-- Bucket name: office-photos
-- Public:      true   (so photo_url works without signed URLs)
"""


# ══════════════════════════════════════════════════════════
#  STORAGE
# ══════════════════════════════════════════════════════════

def ensure_bucket() -> None:
    """Create the storage bucket if it does not already exist."""
    buckets = supabase.storage.list_buckets()
    existing = {b.name for b in buckets}
    if BUCKET not in existing:
        supabase.storage.create_bucket(
            BUCKET,
            options={"public": True}   # Public so photo_url works without signing
        )
        print(f"[offices] Created storage bucket '{BUCKET}'.")
    else:
        print(f"[offices] Storage bucket '{BUCKET}' already exists.")


def upload_photo(file_path: str | Path, content_type: Optional[str] = None) -> str:
    """
    Upload a local image file to Supabase Storage.

    Args:
        file_path:    Local path to the image (PNG / JPG / WEBP).
        content_type: MIME type, e.g. 'image/jpeg'. Auto-detected if omitted.

    Returns:
        Public URL of the uploaded image.

    Raises:
        ValueError: If the file extension is not allowed.
        FileNotFoundError: If the local file does not exist.
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = file_path.suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp"}
    if ext not in allowed:
        raise ValueError(f"Extension '{ext}' not allowed. Use: {allowed}")

    if content_type is None:
        content_type, _ = mimetypes.guess_type(str(file_path))
        content_type = content_type or "application/octet-stream"

    storage_path = f"{PHOTO_PREFIX}/{uuid.uuid4().hex}{ext}"

    with open(file_path, "rb") as fh:
        supabase.storage.from_(BUCKET).upload(
            path=storage_path,
            file=fh,
            file_options={"content-type": content_type},
        )

    public_url: str = supabase.storage.from_(BUCKET).get_public_url(storage_path)
    return public_url


def delete_photo(public_url: str) -> None:
    """
    Delete a photo from Supabase Storage given its public URL.

    Args:
        public_url: The public URL returned by upload_photo().
    """
    # Extract the storage path from the public URL
    # e.g. https://<project>.supabase.co/storage/v1/object/public/office-photos/offices/abc.jpg
    marker = f"/object/public/{BUCKET}/"
    idx = public_url.find(marker)
    if idx == -1:
        raise ValueError(f"Cannot parse storage path from URL: {public_url}")
    storage_path = public_url[idx + len(marker):]
    supabase.storage.from_(BUCKET).remove([storage_path])


# ══════════════════════════════════════════════════════════
#  CRUD HELPERS
# ══════════════════════════════════════════════════════════

def create_office(name: str, photo_url: Optional[str] = None) -> dict:
    """
    Insert a new office record.

    Args:
        name:      Office name (required).
        photo_url: Public URL of the office photo (optional).

    Returns:
        The newly created office row as a dict.
    """
    payload = {"name": name.strip(), "photo_url": photo_url}
    response = (
        supabase.table(TABLE)
        .insert(payload)
        .execute()
    )
    return response.data[0]


def get_offices(limit: int = 100, offset: int = 0) -> list[dict]:
    """
    Fetch offices ordered by creation date (newest first).

    Args:
        limit:  Maximum rows to return (default 100).
        offset: Pagination offset (default 0).

    Returns:
        List of office dicts.
    """
    response = (
        supabase.table(TABLE)
        .select("*")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return response.data


def get_office_by_id(office_id: str) -> Optional[dict]:
    """
    Fetch a single office by its UUID.

    Args:
        office_id: UUID string.

    Returns:
        Office dict, or None if not found.
    """
    response = (
        supabase.table(TABLE)
        .select("*")
        .eq("id", office_id)
        .maybe_single()
        .execute()
    )
    return response.data


def update_office(
    office_id: str,
    name: Optional[str] = None,
    photo_url: Optional[str] = None,
) -> dict:
    """
    Update an existing office record.

    Args:
        office_id: UUID of the office to update.
        name:      New name (optional).
        photo_url: New photo URL (optional).

    Returns:
        Updated office dict.

    Raises:
        ValueError: If neither name nor photo_url is provided.
    """
    payload: dict = {}
    if name is not None:
        payload["name"] = name.strip()
    if photo_url is not None:
        payload["photo_url"] = photo_url

    if not payload:
        raise ValueError("Provide at least one field to update (name or photo_url).")

    response = (
        supabase.table(TABLE)
        .update(payload)
        .eq("id", office_id)
        .execute()
    )
    return response.data[0]


def delete_office(office_id: str, remove_photo: bool = True) -> None:
    """
    Delete an office and optionally its photo from Storage.

    Args:
        office_id:    UUID of the office to delete.
        remove_photo: If True (default), also delete the photo from Storage.
    """
    if remove_photo:
        office = get_office_by_id(office_id)
        if office and office.get("photo_url"):
            try:
                delete_photo(office["photo_url"])
            except Exception as exc:
                print(f"[offices] Warning: could not delete photo — {exc}")

    supabase.table(TABLE).delete().eq("id", office_id).execute()


# ══════════════════════════════════════════════════════════
#  CONVENIENCE: create office + upload photo in one call
# ══════════════════════════════════════════════════════════

def create_office_with_photo(name: str, local_image_path: str | Path) -> dict:
    """
    Upload a photo then insert the office row atomically (best-effort).

    Args:
        name:             Office name.
        local_image_path: Path to the local image file.

    Returns:
        The newly created office dict (includes photo_url).
    """
    photo_url = upload_photo(local_image_path)
    try:
        return create_office(name=name, photo_url=photo_url)
    except Exception:
        # Roll back the uploaded photo if the DB insert fails
        try:
            delete_photo(photo_url)
        except Exception:
            pass
        raise


# ══════════════════════════════════════════════════════════
#  CLI / quick test
# ══════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=== Supabase Offices Module ===\n")
    print("Schema SQL to run in Supabase SQL Editor:\n")
    print(SCHEMA_SQL)

    # Uncomment to test against a live Supabase project:
    # ensure_bucket()
    # office = create_office("Office of the Mayor")
    # print("Created:", office)
    # offices = get_offices()
    # print(f"Total offices: {len(offices)}")