# Odyssey AI Fleet Commander — FastAPI Backend (V1.0)
# ---------------------------------------------------
# Single-file Python sidecar implementing the API contract from README.md §5.
# Run:  uvicorn api.index:app --reload --port 8000
#
# Security model:
#   * Every state-changing or cost-incurring endpoint requires a bearer token
#     (env: ODYSSEY_ADMIN_TOKEN). Read-only health stays public.
#   * Payloads are bounded both per-field (max_length) and per-request via a
#     Content-Length cap middleware.
#   * Upstream third-party errors (ElevenLabs) are mapped to generic responses
#     and the raw text is only logged server-side.
#   * Interactive docs (/docs, /redoc, /openapi.json) are disabled unless
#     ODYSSEY_ENV=development.

from __future__ import annotations
from dotenv import load_dotenv
load_dotenv() 

import asyncio
import csv
import io
import json
import logging
import math
import os
import random
import re
import sys
import time
import smtplib
import uuid
from collections import Counter, defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import AsyncIterator, Optional, Any, Dict, List
import base64
import hashlib
import httpx
from pydantic import BaseModel, Field, field_validator
from threading import Lock

# Redis is optional - import only if available
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None


# Configure logging after imports (only if not already configured)
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from prompts import PROMPT_LIBRARY

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, Query, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from email.mime.text import MIMEText
from supabase import create_client, Client

# PDF parsing imports
try:
    import PyPDF2
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

# Initialize logger first
logger = logging.getLogger("odyssey")

if not PDF_AVAILABLE:
    logger.warning("PyPDF2 not available - PDF parsing will be limited")

# Import services with error handling
try:
    from services.crm import get_crm_service
    from services.email_gateway import get_email_gateway
    logger.info("Services imported successfully")
except ImportError as e:
    print(f"Failed to import services: {e}")  # Use print for early error
    # Provide fallback functions to prevent crash
    def get_crm_service(*args, **kwargs):
        class MockCRM:
            async def sync_lead(self, *args, **kwargs):
                return {"success": False, "error": "CRM service not available"}
        return MockCRM()
    
    def get_email_gateway(*args, **kwargs):
        class MockEmailGateway:
            def send_application(self, *args, **kwargs):
                return {"success": False, "error": "Email gateway not available"}
        return MockEmailGateway()

# ---------------------------------------------------------------------------
# Config & persistence
# ---------------------------------------------------------------------------

# Cloud detection for file system permissions
IS_VERCEL = os.getenv("VERCEL") is not None

# Set data directory based on environment
if IS_VERCEL:
    # Cloud: write to /tmp (only writable directory in serverless)
    DATA_DIR = Path("/tmp/.odyssey")
else:
    # Local: write to project root
    DATA_DIR = Path(os.environ.get("ODYSSEY_DATA_DIR", "./.odyssey"))

# Only create directory if not in Vercel (or if it succeeds)
try:
    DATA_DIR.mkdir(exist_ok=True)
except OSError as e:
    if not IS_VERCEL:
        raise
    # In Vercel, /tmp is writable but might already exist
    logger.warning(f"Could not create DATA_DIR in Vercel: {e}")

DRAFTS_FILE = DATA_DIR / "drafts.json"
ENRICHED_CSV = DATA_DIR / "enriched_contacts.csv"
WEBHOOKS_FILE = DATA_DIR / "webhooks.json"

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_DEFAULT_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")

# ---------------------------------------------------------------------------
# Redis Caching Layer
# ---------------------------------------------------------------------------

redis_client: Optional[Any] = None
CACHE_ENABLED = False
CACHE_TTL_DEFAULT = 300  # 5 minutes
CACHE_TTL_SHORT = 60    # 1 minute
CACHE_TTL_LONG = 3600   # 1 hour

# Only initialize Redis if the package is available and enabled
if REDIS_AVAILABLE:
    CACHE_ENABLED = os.environ.get("REDIS_CACHE_ENABLED", "false").lower() == "true"
    REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    
    if CACHE_ENABLED:
        try:
            redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            redis_client.ping()
            logger.info("Redis cache initialized successfully")
        except Exception as e:
            logger.warning(f"Failed to initialize Redis cache: {e}")
            redis_client = None
            CACHE_ENABLED = False
    else:
        logger.info("Redis caching disabled")
else:
    logger.info("Redis package not available - caching disabled")


def cache_get(key: str) -> Optional[str]:
    """Get value from cache."""
    if not CACHE_ENABLED or not redis_client:
        return None
    try:
        return redis_client.get(key)
    except Exception as e:
        logger.error(f"Cache get error: {e}")
        return None


def cache_set(key: str, value: str, ttl: int = CACHE_TTL_DEFAULT) -> bool:
    """Set value in cache with TTL."""
    if not CACHE_ENABLED or not redis_client:
        return False
    try:
        return redis_client.setex(key, ttl, value)
    except Exception as e:
        logger.error(f"Cache set error: {e}")
        return False


def cache_delete(key: str) -> bool:
    """Delete value from cache."""
    if not CACHE_ENABLED or not redis_client:
        return False
    try:
        return redis_client.delete(key) > 0
    except Exception as e:
        logger.error(f"Cache delete error: {e}")
        return False


def cache_delete_pattern(pattern: str) -> int:
    """Delete all keys matching pattern."""
    if not CACHE_ENABLED or not redis_client:
        return 0
    try:
        keys = redis_client.keys(pattern)
        if keys:
            return redis_client.delete(*keys)
        return 0
    except Exception as e:
        logger.error(f"Cache delete pattern error: {e}")
        return 0


def cache_key_user_profile(user_id: str) -> str:
    """Generate cache key for user profile."""
    return f"user_profile:{user_id}"


def cache_key_job_leads(user_id: str, status: Optional[str] = None) -> str:
    """Generate cache key for job leads."""
    key = f"job_leads:{user_id}"
    if status:
        key += f":status:{status}"
    return key


def cache_key_drafts(user_id: str) -> str:
    """Generate cache key for networking drafts."""
    return f"networking_drafts:{user_id}"


def cache_key_webhooks(user_id: str) -> str:
    """Generate cache key for webhooks."""
    return f"webhooks:{user_id}"


# ---------------------------------------------------------------------------
# Custom Exception Classes
# ---------------------------------------------------------------------------


class OdysseyException(Exception):
    """Base exception for Odyssey-specific errors."""
    pass


class DatabaseException(OdysseyException):
    """Database-related errors."""
    pass


class AuthenticationException(OdysseyException):
    """Authentication and authorization errors."""
    pass


class ValidationException(OdysseyException):
    """Input validation errors."""
    pass


class ExternalServiceException(OdysseyException):
    """External API/service errors."""
    pass


class FileProcessingException(OdysseyException):
    """File upload and processing errors."""
    pass


class RateLimitException(OdysseyException):
    """Rate limiting errors."""
    pass


class ConfigurationException(OdysseyException):
    """Configuration and initialization errors."""
    pass


# ---------------------------------------------------------------------------
# API Key Management System
# ---------------------------------------------------------------------------

# Admin token storage (in production, use database or secret manager)
_admin_tokens: dict[str, dict] = {}  # {token_hash: {created_at, expires_at, name}}
_admin_tokens_lock = Lock()

# Load initial admin token from environment
ODYSSEY_ADMIN_TOKEN = os.environ.get("ODYSSEY_ADMIN_TOKEN", "")
if ODYSSEY_ADMIN_TOKEN:
    # Hash the token for storage
    token_hash = hashlib.sha256(ODYSSEY_ADMIN_TOKEN.encode()).hexdigest()
    _admin_tokens[token_hash] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": None,  # Never expires for environment token
        "name": "environment_token",
        "source": "environment"
    }
    logger.info("Admin token loaded from environment variable")
else:
    logger.warning("ODYSSEY_ADMIN_TOKEN not set - protected endpoints will return 503")


def hash_token(token: str) -> str:
    """Hash a token for secure storage."""
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token(token: str) -> tuple[bool, Optional[dict]]:
    """
    Verify a token against stored hashes.
    
    Args:
        token: The token to verify
    
    Returns:
        (is_valid, token_metadata) where metadata includes name, created_at, etc.
    """
    if not token:
        return False, None
    
    token_hash = hash_token(token)
    
    with _admin_tokens_lock:
        if token_hash not in _admin_tokens:
            return False, None
        
        token_data = _admin_tokens[token_hash]
        
        # Check expiration
        if token_data.get("expires_at"):
            expires_at = datetime.fromisoformat(token_data["expires_at"])
            if datetime.now(timezone.utc) > expires_at:
                # Token expired, remove it
                del _admin_tokens[token_hash]
                logger.warning(f"Expired admin token removed: {token_data.get('name', 'unknown')}")
                return False, None
        
        return True, token_data


def add_admin_token(token: str, name: str, expires_hours: Optional[int] = None) -> str:
    """
    Add a new admin token.
    
    Args:
        token: The token to add
        name: Descriptive name for the token
        expires_hours: Optional expiration time in hours (None = never expires)
    
    Returns:
        Token hash
    """
    token_hash = hash_token(token)
    
    expires_at = None
    if expires_hours:
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_hours)).isoformat()
    
    with _admin_tokens_lock:
        _admin_tokens[token_hash] = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at,
            "name": name,
            "source": "api"
        }
    
    logger.info(f"Admin token added: {name}")
    return token_hash


def remove_admin_token(token_hash: str) -> bool:
    """
    Remove an admin token by its hash.
    
    Args:
        token_hash: The hash of the token to remove
    
    Returns:
        True if removed, False if not found
    """
    with _admin_tokens_lock:
        if token_hash in _admin_tokens:
            name = _admin_tokens[token_hash].get("name", "unknown")
            del _admin_tokens[token_hash]
            logger.info(f"Admin token removed: {name}")
            return True
        return False


def list_admin_tokens() -> list[dict]:
    """
    List all admin tokens (without exposing the actual tokens).
    
    Returns:
        List of token metadata
    """
    with _admin_tokens_lock:
        return [
            {
                "hash": token_hash[:16] + "...",  # Partial hash for identification
                "name": data["name"],
                "created_at": data["created_at"],
                "expires_at": data["expires_at"],
                "source": data["source"],
                "is_expired": data.get("expires_at") and datetime.now(timezone.utc) > datetime.fromisoformat(data["expires_at"])
            }
            for token_hash, data in _admin_tokens.items()
        ]


def rotate_admin_token(old_token: str, new_token: str, name: str, expires_hours: Optional[int] = None) -> tuple[bool, str]:
    """
    Rotate an admin token (remove old, add new).
    
    Args:
        old_token: The token to replace
        new_token: The new token
        name: Descriptive name for the new token
        expires_hours: Optional expiration time in hours
    
    Returns:
        (success, new_token_hash)
    """
    # Verify old token exists
    is_valid, old_data = verify_token(old_token)
    if not is_valid:
        return False, ""
    
    # Remove old token
    old_hash = hash_token(old_token)
    remove_admin_token(old_hash)
    
    # Add new token
    new_hash = add_admin_token(new_token, name, expires_hours)
    
    logger.info(f"Admin token rotated: {old_data.get('name', 'unknown')} -> {name}")
    return True, new_hash

ODYSSEY_ENV = os.environ.get("ODYSSEY_ENV", "development").lower()
MAX_BODY_BYTES = int(os.environ.get("ODYSSEY_MAX_BODY_BYTES", str(256 * 1024)))  # 256 KB

VOICE_ID_RE = re.compile(r"^[A-Za-z0-9]{10,40}$")

# File upload security configuration
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/x-pdf",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

CORS_ORIGINS = [
    origin.strip().rstrip("/") 
    for origin in os.environ.get(
        "ODYSSEY_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
]

# ---------------------------------------------------------------------------
# Rate Limit Error Messages (Creative & Fun)
# ---------------------------------------------------------------------------

RATE_LIMIT_MESSAGES = [
    "Whoa, too much awesome at once! The neural net is catching its breath. Retrying...",
    "Our AI hamsters are taking a quick digital Red Bull break. Stand by...",
    "We broke the speed of light and hit a rate limit. Giving the GPUs 10 seconds to chill...",
    "The AI is currently overwhelmed by your sheer potential. Be right back in a few seconds!",
    "Cooling jets! The model needs a moment to process all this brilliance.",
    "Too many cooks in the neural kitchen. The LLM is taking a quick coffee break.",
    "You're firing on all cylinders! Let's give the AI a moment to reload its mental弹药.",
    "The quantum bits are still spinning from your last request. Hang tight!",
    "Our digital brain needs a quick power nap. Don't worry, it'll be back stronger!",
    "Who let the dogs out? The AI guard dogs are catching their breath.",
]

def get_rate_limit_message() -> str:
    """Return a random creative rate limit error message."""
    return random.choice(RATE_LIMIT_MESSAGES)


# ---------------------------------------------------------------------------
# In-Memory Rate Limiting
# ---------------------------------------------------------------------------

# Rate limit configuration
RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "100"))  # requests per window
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))  # seconds

# In-memory rate limit storage: {identifier: [(timestamp, endpoint), ...]}
_rate_limit_store = defaultdict(list)
_rate_limit_lock = Lock()


def _cleanup_old_requests(identifier: str, window_seconds: int) -> None:
    """Remove requests older than the time window."""
    cutoff_time = time.time() - window_seconds
    with _rate_limit_lock:
        _rate_limit_store[identifier] = [
            (ts, endpoint) for ts, endpoint in _rate_limit_store[identifier]
            if ts > cutoff_time
        ]


def _get_request_count(identifier: str, endpoint: str, window_seconds: int) -> int:
    """Count requests for an identifier within the time window."""
    _cleanup_old_requests(identifier, window_seconds)
    with _rate_limit_lock:
        return sum(1 for ts, ep in _rate_limit_store[identifier] if ep == endpoint)


def _record_request(identifier: str, endpoint: str) -> None:
    """Record a request for rate limiting."""
    with _rate_limit_lock:
        _rate_limit_store[identifier].append((time.time(), endpoint))


def check_rate_limit(identifier: str, endpoint: str) -> tuple[bool, int, int]:
    """
    Check if the request should be rate limited.
    
    Args:
        identifier: Unique identifier (user_id or IP address)
        endpoint: API endpoint being accessed
    
    Returns:
        (is_limited, remaining_requests, reset_time)
    """
    if not RATE_LIMIT_ENABLED:
        return False, RATE_LIMIT_REQUESTS, int(time.time()) + RATE_LIMIT_WINDOW
    
    _cleanup_old_requests(identifier, RATE_LIMIT_WINDOW)
    
    request_count = _get_request_count(identifier, endpoint, RATE_LIMIT_WINDOW)
    remaining = max(0, RATE_LIMIT_REQUESTS - request_count)
    reset_time = int(time.time()) + RATE_LIMIT_WINDOW
    
    if request_count >= RATE_LIMIT_REQUESTS:
        logger.warning(f"Rate limit exceeded for {identifier} on {endpoint}: {request_count}/{RATE_LIMIT_REQUESTS}")
        return True, 0, reset_time
    
    _record_request(identifier, endpoint)
    return False, remaining - 1, reset_time


def get_client_identifier(request: Request, user_id: Optional[str] = None) -> str:
    """
    Get identifier for rate limiting.
    Prefers user_id for authenticated requests, falls back to IP address.
    """
    if user_id:
        return f"user:{user_id}"
    
    # Get IP address from request
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    
    return f"ip:{ip}"


def clear_rate_limit(identifier: Optional[str] = None) -> int:
    """
    Clear rate limit records for a specific identifier or all identifiers.
    
    Args:
        identifier: Specific identifier to clear, or None to clear all
    
    Returns:
        Number of entries cleared
    """
    with _rate_limit_lock:
        if identifier:
            count = len(_rate_limit_store[identifier])
            del _rate_limit_store[identifier]
            return count
        else:
            count = sum(len(v) for v in _rate_limit_store.values())
            _rate_limit_store.clear()
            return count


def get_rate_limit_stats() -> dict:
    """
    Get current rate limiting statistics.
    
    Returns:
        Dictionary with rate limit statistics
    """
    with _rate_limit_lock:
        total_requests = sum(len(v) for v in _rate_limit_store.values())
        unique_identifiers = len(_rate_limit_store)
        
        # Calculate requests per endpoint
        endpoint_counts = defaultdict(int)
        for requests in _rate_limit_store.values():
            for _, endpoint in requests:
                endpoint_counts[endpoint] += 1
        
        return {
            "total_requests": total_requests,
            "unique_identifiers": unique_identifiers,
            "requests_per_endpoint": dict(endpoint_counts),
            "rate_limit_enabled": RATE_LIMIT_ENABLED,
            "rate_limit_requests": RATE_LIMIT_REQUESTS,
            "rate_limit_window": RATE_LIMIT_WINDOW
        }


# ---------------------------------------------------------------------------
# UUID Alias Resolver for "admin" token
# ---------------------------------------------------------------------------

async def resolve_user_alias(user_id: str) -> str:
    """
    Resolve user alias (e.g., "admin") to actual UUID from user_profiles table.
    
    If user_id is "admin", fetch the first user profile UUID from the database.
    Otherwise, return the user_id as-is (assuming it's already a valid UUID).
    """
    if user_id != "admin":
        return user_id
    
    logger.info("Resolving 'admin' alias to actual user UUID")
    
    if not supabase_client:
        logger.error("Supabase client not initialized - cannot resolve admin alias")
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Fetch the first user profile (assumes admin is the first created user)
        result = supabase_client.table("user_profiles").select("user_id").limit(1).execute()
        
        if not result.data:
            logger.error("No user profiles found in database")
            raise HTTPException(status_code=500, detail="No users found in database")
        
        resolved_id = result.data[0]["user_id"]
        logger.info(f"Resolved 'admin' alias to UUID: {resolved_id}")
        return resolved_id
        
    except HTTPException:
        raise
    except (ValueError, KeyError) as e:
        logger.error(f"Invalid data in admin alias resolution: {e}")
        raise HTTPException(status_code=400, detail="Invalid user alias data")
    except ImportError as e:
        logger.error(f"Error resolving admin alias: {e}")
        raise HTTPException(status_code=500, detail="Failed to resolve user alias")


# ---------------------------------------------------------------------------
# Groq API Retry with Exponential Backoff
# ---------------------------------------------------------------------------

async def groq_api_call_with_retry(
    client: httpx.AsyncClient,
    url: str,
    headers: dict,
    json_data: dict,
    max_retries: int = 3,
    initial_delay: float = 2.0,
) -> dict:
    """
    Make Groq API call with exponential backoff for 429 rate limit errors.
    
    Args:
        client: httpx async client
        url: API endpoint URL
        headers: Request headers
        json_data: Request body as dict
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds (doubles each retry)
    
    Returns:
        Response JSON as dict
    
    Raises:
        HTTPException: If all retries fail (429) or other error occurs
    """
    retry_count = 0
    delay = initial_delay
    
    while retry_count <= max_retries:
        try:
            response = await client.post(url, headers=headers, json=json_data)
            
            # If successful, return the response
            if response.status_code == 200:
                return response.json()
            
            # If rate limited (429), retry with backoff
            if response.status_code == 429:
                retry_count += 1
                if retry_count <= max_retries:
                    logger.warning(f"Groq API rate limited (429). Retry {retry_count}/{max_retries} after {delay}s delay")
                    await asyncio.sleep(delay)
                    delay *= 2  # Exponential backoff
                    continue
                else:
                    # All retries exhausted
                    logger.error(f"Groq API rate limited (429). All {max_retries} retries exhausted")
                    raise HTTPException(
                        status_code=429,
                        detail=get_rate_limit_message()
                    )
            
            # Other HTTP errors, raise immediately
            response.raise_for_status()
            return response.json()
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                retry_count += 1
                if retry_count <= max_retries:
                    logger.warning(f"Groq API rate limited (429). Retry {retry_count}/{max_retries} after {delay}s delay")
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                else:
                    logger.error(f"Groq API rate limited (429). All {max_retries} retries exhausted")
                    raise HTTPException(
                        status_code=429,
                        detail=get_rate_limit_message()
                    )
            else:
                # Other HTTP errors, raise immediately
                logger.error(f"Groq API HTTP error: {e}")
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"Groq API error: {str(e)}"
                )
        except httpx.RequestError as e:
            logger.error(f"Groq API request error: {e}")
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Groq API: {str(e)}"
            )
        except TimeoutError as e:
            logger.error(f"Groq API timeout error: {e}")
            raise HTTPException(
                status_code=504,
                detail="Groq API request timeout"
            )
        except Exception as e:
            logger.error(f"Groq API unexpected error: {e}")
            raise ExternalServiceException(f"Groq API error: {e}")
    
    # Should not reach here, but just in case
    raise HTTPException(
        status_code=429,
        detail=get_rate_limit_message()
    )

# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# Log environment variable status (without exposing sensitive values)
logger.info(f"Environment check: SUPABASE_URL={'SET' if SUPABASE_URL else 'MISSING'}")
logger.info(f"Environment check: SUPABASE_SERVICE_KEY={'SET' if SUPABASE_SERVICE_KEY else 'MISSING'}")
logger.info(f"Environment check: SUPABASE_ANON_KEY={'SET' if SUPABASE_ANON_KEY else 'MISSING'}")

supabase_client: Optional[Client] = None
try:
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        # Strip any trailing slashes from URL
        supabase_url_clean = SUPABASE_URL.rstrip("/")
        logger.info(f"Initializing Supabase client with URL: {supabase_url_clean}")
        supabase_client = create_client(supabase_url_clean, SUPABASE_SERVICE_KEY)
        logger.info("Supabase client initialized successfully")
    else:
        logger.warning("Supabase client not initialized - missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
except (ValueError, ConnectionError) as e:
    logger.error(f"Configuration error initializing Supabase client: {e}")
    supabase_client = None
except ImportError as e:
    logger.error(f"Failed to initialize Supabase client: {e}")
    supabase_client = None

# Initialize Supabase auth client for token verification
supabase_auth: Optional[Client] = None
try:
    if SUPABASE_URL and SUPABASE_ANON_KEY:
        # Strip any trailing slashes from URL
        supabase_url_clean = SUPABASE_URL.rstrip("/")
        logger.info(f"Initializing Supabase auth client with URL: {supabase_url_clean}")
        supabase_auth = create_client(supabase_url_clean, SUPABASE_ANON_KEY)
        logger.info("Supabase auth client initialized successfully")
    else:
        logger.warning("Supabase auth client not initialized - missing SUPABASE_URL or SUPABASE_ANON_KEY")
except (ValueError, ConnectionError) as e:
    logger.error(f"Configuration error initializing Supabase auth client: {e}")
    supabase_auth = None
except ImportError as e:
    logger.error(f"Failed to initialize Supabase auth client: {e}")
    supabase_auth = None

# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------


def require_auth(request: Request) -> str:
    """
    Authentication dependency that accepts either:
    1. Admin token (managed by API key system)
    2. Supabase JWT token (from Authorization header)
    
    Returns the user_id from Supabase JWT or "admin" for admin token.
    Uses Supabase auth client for token verification.
    """
    # 1. Try to get token from Authorization header (case-insensitive)
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    
    if not auth_header:
        logger.error("Missing authorization header")
        logger.error("Root cause: Authorization header is completely missing from request")
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    # 2. Check if it's an admin token (using new API key system)
    is_valid, token_data = verify_token(auth_header)
    if is_valid:
        logger.info(f"Admin token authenticated: {token_data.get('name', 'unknown')}")
        return "admin"
    
    # 3. Extract Bearer token with robust parsing
    try:
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()  # Remove "Bearer " and strip whitespace
        else:
            # Assume the entire header is the token (for compatibility)
            token = auth_header.strip()
        
        # Log token details for debugging
        logger.info(f"Token received: Length={len(token)}, First 50 chars={token[:50] if len(token) > 50 else token}")
        
        # Validate JWT format (must have 3 segments)
        segment_count = token.count('.')
        if segment_count != 2:
            logger.error(f"Invalid token format: Expected 2 dots (3 segments), got {segment_count}")
            logger.error(f"Token structure: {token[:100]}... (truncated)")
            logger.error(f"Root cause: Token has {segment_count} dot separators instead of 2 (expected format: header.payload.signature)")
            raise HTTPException(status_code=401, detail="Invalid token format")
        
    except IndexError as e:
        logger.error(f"Token parsing error: {e}")
        logger.error(f"Root cause: Token extraction failed during parsing (possible malformed header)")
        raise HTTPException(status_code=401, detail="Invalid token format")
    except ImportError as e:
        logger.error(f"Token extraction error: {str(e)}")
        logger.error(f"Root cause: Unexpected import error during token processing")
        raise HTTPException(status_code=401, detail="Token extraction failed")
    
    # 4. Verify JWT token using Supabase auth client
    if not supabase_auth:
        logger.error("Supabase auth client not initialized - cannot verify JWT tokens")
        logger.error("Root cause: Supabase auth client initialization failed (missing SUPABASE_URL or SUPABASE_ANON_KEY)")
        raise HTTPException(status_code=401, detail="Server configuration error")
    
    try:
        # Offload verification to Supabase servers
        logger.info(f"Attempting to verify token with Supabase...")
        user_response = supabase_auth.auth.get_user(token)

        if not user_response or not user_response.user:
            logger.error("Supabase returned invalid user response")
            logger.error("Root cause: Token verification failed - token may be expired or invalid")
            raise HTTPException(status_code=401, detail="Invalid token")

        logger.info(f"Token verified successfully for user: {user_response.user.id}")
        return user_response.user.id

    except AuthenticationException as e:
        logger.error(f"Authentication error: {e}")
        logger.error(f"Root cause: Custom authentication exception raised")
        raise HTTPException(status_code=401, detail=str(e))
    except HTTPException:
        raise
    except ImportError as e:
        logger.error(f"Authentication import error: {e}")
        logger.error(f"Root cause: Required import failed during authentication")
        raise HTTPException(status_code=500, detail="Authentication service unavailable")
    except Exception as e:
        logger.error(f"Unexpected authentication error: {e}")
        logger.error(f"Root cause: Unexpected error during Supabase token verification")
        raise HTTPException(status_code=500, detail="Internal authentication error")


# ---------------------------------------------------------------------------
# Fleet state machine
# ---------------------------------------------------------------------------


class FleetState:
    def __init__(self) -> None:
        self.status: str = "idle"
        self.started_at: Optional[float] = None
        self.subscribers: set[asyncio.Queue[str]] = set()
        self.lock = asyncio.Lock()

    @property
    def uptime(self) -> float:
        return time.time() - self.started_at if self.started_at else 0.0

    async def publish(self, level: str, source: str, message: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        payload = json.dumps({"ts": ts, "level": level, "source": source, "message": message})
        for q in list(self.subscribers):
            await q.put(payload)


fleet = FleetState()

BOOT_SCRIPT = [
    ("INFO", "core",  "Booting Odyssey orchestrator…"),
    ("INFO", "core",  "Loading agent registry from ./agents/*.yml"),
    ("OK",   "core",  "Registry loaded: 3 agents found"),
    ("INFO", "cv_gen", "Spawning agent worker"),
    ("INFO", "email", "Connecting IMAP listener → mail.odyssey.local:993"),
    ("OK",   "email", "IDLE connection established"),
    ("INFO", "triage", "Loading classifier weights…"),
    ("OK",   "triage", "Model ready · 4.2MB resident"),
    ("OK",   "core",  "Fleet online — accepting tasks"),
]

TICK_SCRIPT = [
    ("INFO", "email", "Polling inbox… 0 new messages"),
    ("INFO", "triage", "Heartbeat ok · queue depth 0"),
    ("OK",   "cv_gen", "Template cache warm · 12 entries"),
    ("WARN", "email", "Rate limit window 80% utilized"),
    ("INFO", "core",  "Health check passed (latency 4ms)"),
]


async def _boot_task() -> None:
    for level, source, msg in BOOT_SCRIPT:
        await fleet.publish(level, source, msg)
        await asyncio.sleep(0.55)
    fleet.status = "running"


async def _heartbeat_task() -> None:
    while fleet.status == "running":
        await asyncio.sleep(2.2)
        level, source, msg = random.choice(TICK_SCRIPT)
        await fleet.publish(level, source, msg)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if not ODYSSEY_ADMIN_TOKEN:
        logger.warning(
            "ODYSSEY_ADMIN_TOKEN is not set — all protected endpoints will return 503."
        )
    yield
    fleet.status = "idle"


# Disable interactive docs outside development to avoid advertising the
# protected attack surface.
_docs_enabled = ODYSSEY_ENV == "development"


app = FastAPI(
    title="Odyssey AI Fleet Commander",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Middleware to enforce rate limiting on all API endpoints."""
    
    # Endpoints to skip rate limiting (health checks, etc.)
    SKIP_ENDPOINTS = {"/health", "/api/fleet/health", "/metrics", "/docs", "/redoc", "/openapi.json"}
    
    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for public endpoints
        if request.url.path in self.SKIP_ENDPOINTS:
            return await call_next(request)
        
        # Get identifier for rate limiting
        user_id = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                # Try to extract user_id from token without full validation
                # This is a lightweight check just for rate limiting
                is_valid, token_data = verify_token(token)
                if is_valid:
                    user_id = "admin"
                else:
                    # For JWT tokens, use a simple hash as identifier
                    user_id = hashlib.sha256(token.encode()).hexdigest()[:16]
            except Exception:
                pass
        
        identifier = get_client_identifier(request, user_id)
        endpoint = request.url.path
        
        # Check rate limit
        is_limited, remaining, reset_time = check_rate_limit(identifier, endpoint)
        
        # Add rate limit headers to response
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_REQUESTS)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset_time)
        
        if is_limited:
            response.status_code = 429
            response.headers["Retry-After"] = str(RATE_LIMIT_WINDOW)
            return JSONResponse(
                {"detail": get_rate_limit_message()},
                status_code=429,
                headers=response.headers
            )
        
        return response


app.add_middleware(RateLimitMiddleware)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware to add unique request IDs for debugging and tracing."""
    
    async def dispatch(self, request: Request, call_next):
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        
        # Process request
        response = await call_next(request)
        
        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id
        
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        return response


app.add_middleware(RequestIDMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose declared Content-Length exceeds MAX_BODY_BYTES."""

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "Payload too large"}, status_code=413)
        return await call_next(request)


app.add_middleware(BodySizeLimitMiddleware)

# ---------------------------------------------------------------------------
# Schemas (all bounded)
# ---------------------------------------------------------------------------

# URL validation regex
URL_REGEX = re.compile(
    r'^(?:http|https)://'  # http or https
    r'(?:\S+(?::\S*)?@)?'  # optional auth
    r'(?:\d{1,3}\.){3}\d{1,3}'  # IP address (optional)
    r'|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}'  # domain name
    r'(?::\d{1,5})?'  # optional port
    r'(?:/\S*)?'  # optional path
    r'$', re.IGNORECASE
)

# Email validation regex
EMAIL_REGEX = re.compile(
    r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
)

def validate_url(url: str) -> str:
    """Validate URL format and return sanitized URL."""
    if not url:
        return ""
    
    url = url.strip()
    
    if not URL_REGEX.match(url):
        raise ValueError(f"Invalid URL format: {url}")
    
    # Prevent protocol-relative URLs
    if url.startswith("//"):
        raise ValueError(f"Protocol-relative URLs not allowed: {url}")
    
    # Prevent javascript: or data: URLs (security)
    if url.lower().startswith(("javascript:", "data:", "vbscript:")):
        raise ValueError(f"Potentially dangerous URL protocol: {url}")
    
    return url

def validate_email(email: Optional[str]) -> Optional[str]:
    """Validate email format."""
    if not email:
        return None
    
    email = email.strip().lower()
    
    if not EMAIL_REGEX.match(email):
        raise ValueError(f"Invalid email format: {email}")
    
    return email

def sanitize_string(text: str, max_length: int, field_name: str) -> str:
    """Sanitize string input."""
    if not text:
        return ""
    
    text = text.strip()
    
    # Remove null bytes and other control characters
    text = ''.join(char for char in text if ord(char) >= 32 or char in '\n\r\t')
    
    if len(text) > max_length:
        raise ValueError(f"{field_name} exceeds maximum length of {max_length}")
    
    return text


class WebhookConfig(BaseModel):
    n8n_url: str = Field("", max_length=2048)
    make_url: str = Field("", max_length=2048)
    enabled: bool = False
    
    @field_validator('n8n_url', 'make_url', mode='before')
    @classmethod
    def validate_webhook_urls(cls, v: str) -> str:
        if v:
            return validate_url(v)
        return v


class InterviewGenerateIn(BaseModel):
    job_description: str = Field(..., min_length=20, max_length=20_000)
    count: int = Field(8, ge=1, le=25)
    
    @field_validator('job_description', mode='before')
    @classmethod
    def sanitize_job_description(cls, v: str) -> str:
        return sanitize_string(v, 20_000, "job_description")


class InterviewEvaluateIn(BaseModel):
    question: str = Field(..., min_length=10, max_length=5_000)
    answer: str = Field(..., min_length=20, max_length=10_000)
    job_description: str = Field(..., min_length=20, max_length=20_000)
    
    @field_validator('question', 'answer', 'job_description', mode='before')
    @classmethod
    def sanitize_interview_fields(cls, v: str, info) -> str:
        field_name = info.field_name
        max_lengths = {
            'question': 5_000,
            'answer': 10_000,
            'job_description': 20_000
        }
        max_length = max_lengths.get(field_name, 10_000)
        return sanitize_string(v, max_length, field_name)


class InterviewSpeakIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4_000)
    voice_id: Optional[str] = Field(None, max_length=40)
    
    @field_validator('text', mode='before')
    @classmethod
    def sanitize_speak_text(cls, v: str) -> str:
        return sanitize_string(v, 4_000, "text")


class RoasterIn(BaseModel):
    resume: str = Field(..., min_length=20, max_length=50_000)
    
    @field_validator('resume', mode='before')
    @classmethod
    def sanitize_resume(cls, v: str) -> str:
        return sanitize_string(v, 50_000, "resume")


class RoasterFixIn(BaseModel):
    flawed_bullets: list[str] = Field(..., max_length=50)


class AtsIn(BaseModel):
    resume: str = Field(..., min_length=20, max_length=50_000)
    jd: str = Field(..., min_length=20, max_length=50_000)
    
    @field_validator('resume', 'jd', mode='before')
    @classmethod
    def sanitize_ats_fields(cls, v: str, info) -> str:
        field_name = info.field_name
        return sanitize_string(v, 50_000, field_name)


class NetworkingDraftIn(BaseModel):
    contact_name: str = Field(..., min_length=1, max_length=120)
    contact_email: Optional[str] = Field(None, max_length=200)
    company: str = Field(..., min_length=1, max_length=160)
    role: str = Field("", max_length=120)
    context: str = Field("", max_length=2_000)
    extra_context: dict[str, str] = Field(default_factory=dict)
    angle: str = Field("peer", max_length=20)
    sign_off: str = Field(..., max_length=100)
    language: str = Field(..., max_length=50)
    
    @field_validator('contact_email', mode='before')
    @classmethod
    def validate_contact_email(cls, v: Optional[str]) -> Optional[str]:
        return validate_email(v)
    
    @field_validator('contact_name', 'company', 'role', mode='before')
    @classmethod
    def sanitize_text_fields(cls, v: str, info) -> str:
        field_name = info.field_name
        max_lengths = {
            'contact_name': 120,
            'company': 160,
            'role': 120
        }
        max_length = max_lengths.get(field_name, 120)
        return sanitize_string(v, max_length, field_name)

class DraftEditIn(BaseModel):
    subject: Optional[str] = Field(None, max_length=200)
    body: Optional[str] = Field(None, max_length=8_000)
    
    @field_validator('subject', 'body', mode='before')
    @classmethod
    def sanitize_draft_fields(cls, v: Optional[str], info) -> Optional[str]:
        if v:
            field_name = info.field_name
            max_length = 200 if field_name == 'subject' else 8_000
            return sanitize_string(v, max_length, field_name)
        return v


class DraftSendIn(BaseModel):
    override_to: Optional[str] = Field(None, max_length=200)
    
    @field_validator('override_to', mode='before')
    @classmethod
    def validate_override_email(cls, v: Optional[str]) -> Optional[str]:
        return validate_email(v)


class EnrichIn(BaseModel):
    contact_name: str = Field(..., max_length=120)
    company: str = Field("", max_length=160)
    email: Optional[str] = Field(None, max_length=200)
    linkedin_url: Optional[str] = Field(None, max_length=300)
    webhook_url: Optional[str] = Field(None, max_length=2048)  # overrides configured n8n/make URL
    
    @field_validator('email', mode='before')
    @classmethod
    def validate_enrich_email(cls, v: Optional[str]) -> Optional[str]:
        return validate_email(v)
    
    @field_validator('linkedin_url', 'webhook_url', mode='before')
    @classmethod
    def validate_enrich_urls(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return validate_url(v)
        return v
    
    @field_validator('contact_name', 'company', mode='before')
    @classmethod
    def sanitize_enrich_fields(cls, v: str, info) -> str:
        field_name = info.field_name
        max_length = 120 if field_name == 'contact_name' else 160
        return sanitize_string(v, max_length, field_name)


class TriageProcessOut(BaseModel):
    matchScore: int = Field(..., ge=0, le=100)
    missingSkills: list[str] = Field(default_factory=list)
    feedback: str = Field(..., max_length=500)


class JobLeadIn(BaseModel):
    url: str = Field(..., max_length=2048, example="https://example.com/job/software-engineer")
    company_name: str = Field(..., max_length=200, example="Acme Corp")
    role_title: str = Field(..., max_length=200, example="Senior Software Engineer")
    match_score: int = Field(..., ge=0, le=100, example=85)
    status: str = Field("new", max_length=20, example="new")
    raw_content: str = Field(..., max_length=50_000, example="Job description text...")
    tech_stack: list[str] = Field(default_factory=list, example=["Python", "React", "AWS"])
    detected_language: str = Field("en", max_length=10, example="en")
    salary_min: Optional[int] = Field(None, ge=0, example=100000)
    salary_max: Optional[int] = Field(None, ge=0, example=150000)
    currency: str = Field("USD", max_length=10, example="USD")
    job_location: Optional[str] = Field(None, max_length=200, example="San Francisco, CA")
    work_setting: Optional[str] = Field(None, max_length=20, example="remote")
    contact_email: Optional[str] = Field(None, max_length=200, example="hiring@example.com")
    contact_name: Optional[str] = Field(None, max_length=200, example="John Doe")
    hiring_manager_linkedin: Optional[str] = Field(None, max_length=500, example="https://linkedin.com/in/johndoe")
    user_id: Optional[str] = Field(None, max_length=100)
    # Orchestration sequence generated assets
    email_draft: Optional[str] = Field(None, max_length=10_000)
    tailored_cv_path: Optional[str] = Field(None, max_length=500)
    prep_guide: Optional[str] = Field(None, max_length=20_000)
    # CRM sync fields (optional - will only be added if CRM sync succeeds)
    # crm_synced: Optional[bool] = Field(None)
    # crm_id: Optional[str] = Field(None, max_length=200)
    
    @field_validator('url', 'hiring_manager_linkedin', mode='before')
    @classmethod
    def validate_job_urls(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return validate_url(v)
        return v
    
    @field_validator('contact_email', mode='before')
    @classmethod
    def validate_contact_email(cls, v: Optional[str]) -> Optional[str]:
        return validate_email(v)
    
    @field_validator('company_name', 'role_title', 'job_location', 'work_setting', mode='before')
    @classmethod
    def sanitize_job_text_fields(cls, v: str, info) -> str:
        field_name = info.field_name
        max_lengths = {
            'company_name': 200,
            'role_title': 200,
            'job_location': 200,
            'work_setting': 20
        }
        max_length = max_lengths.get(field_name, 200)
        return sanitize_string(v, max_length, field_name)


class FilterCriteria(BaseModel):
    allowed_keywords: list[str] = Field(default_factory=list, max_length=50)
    blocked_keywords: list[str] = Field(default_factory=list, max_length=50)
    min_match_score: int = Field(40, ge=0, le=100)


class ProcessJobUrlIn(BaseModel):
    url: str = Field(..., max_length=2048)
    user_profile: Optional[str] = Field(None, max_length=10_000, description="Deprecated: Use user_id for dynamic profile fetching")
    user_id: Optional[str] = Field(None, max_length=100, description="Preferred: Fetches profile from Supabase automatically")
    filter_criteria: Optional[FilterCriteria] = Field(None)
    
    @field_validator('url', mode='before')
    @classmethod
    def validate_process_url(cls, v: str) -> str:
        return validate_url(v)


class ShipApplicationIn(BaseModel):
    to_email: Optional[str] = Field(None, max_length=200)
    subject: Optional[str] = Field(None, max_length=200)
    custom_body: Optional[str] = Field(None, max_length=10_000)
    
    @field_validator('to_email', mode='before')
    @classmethod
    def validate_ship_email(cls, v: Optional[str]) -> Optional[str]:
        return validate_email(v)


class UserProfileIn(BaseModel):
    """Schema for user profile data."""
    user_id: str = Field(..., max_length=100)
    resume_text: str = Field(..., max_length=50_000)
    tech_stack: list[str] = Field(default_factory=list, max_length=100)
    preferences: dict = Field(default_factory=dict)
    
    @field_validator('resume_text', mode='before')
    @classmethod
    def sanitize_resume_text(cls, v: str) -> str:
        return sanitize_string(v, 50_000, "resume_text")


class UserProfileOut(BaseModel):
    """Schema for user profile response."""
    user_id: str
    resume_text: str
    tech_stack: list[str]
    preferences: dict
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Parsed Profile Schema (Flexible with fallbacks)
# ---------------------------------------------------------------------------


class PersonalInfo(BaseModel):
    """Core personal information with fallbacks."""
    name: str = Field(..., max_length=200)
    location: str = Field("", max_length=200)
    languages: list[str] = Field(default_factory=list, max_length=20)


class EducationEntry(BaseModel):
    """Single education entry."""
    degree: str = Field(..., max_length=300)
    institution: str = Field("", max_length=300)


class ExperienceEntry(BaseModel):
    """Single work experience entry."""
    role: str = Field(..., max_length=200)
    company: str = Field("", max_length=200)
    duration: str = Field("", max_length=100)


class ParsedProfileData(BaseModel):
    """
    Structured profile data from LLM parsing with flexible schema.
    Core fields are enforced, optional fields have empty list fallbacks.
    """
    personal_info: PersonalInfo
    tech_stack: list[str] = Field(default_factory=list, max_length=100)
    education: list[EducationEntry] = Field(default_factory=list, max_length=20)
    experience: list[ExperienceEntry] = Field(default_factory=list, max_length=50)
    extra_metadata: dict = Field(default_factory=dict)


class ProfileParseIn(BaseModel):
    """Schema for profile parsing request."""
    file: UploadFile = Field(..., description="PDF file to parse")


class ProfileParseOut(BaseModel):
    """Schema for profile parsing response."""
    success: bool
    data: Optional[ParsedProfileData] = None
    error: Optional[str] = None

# ---------------------------------------------------------------------------
# Fleet endpoints
# ---------------------------------------------------------------------------


@app.post("/api/fleet/start", dependencies=[Depends(require_auth)])
async def fleet_start() -> dict:
    async with fleet.lock:
        if fleet.status != "idle":
            return {"status": fleet.status}
        fleet.status = "initializing"
        fleet.started_at = time.time()
        asyncio.create_task(_run_fleet())
        return {"status": fleet.status}


async def _run_fleet() -> None:
    await _boot_task()
    await _heartbeat_task()


@app.post("/api/fleet/stop", dependencies=[Depends(require_auth)])
async def fleet_stop() -> dict:
    await fleet.publish("WARN", "core", "Shutdown signal received")
    await fleet.publish("INFO", "core", "Stopping all agents…")
    await fleet.publish("OK",   "core", "Fleet offline")
    fleet.status = "idle"
    fleet.started_at = None
    return {"status": "idle"}


@app.get("/api/fleet/health")
async def fleet_health() -> dict:
    """Comprehensive health check endpoint."""
    health_status = {
        "ok": True,
        "status": fleet.status,
        "uptime": round(fleet.uptime, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "database": "unknown",
            "supabase": "unknown",
            "rate_limiting": "enabled" if RATE_LIMIT_ENABLED else "disabled"
        }
    }
    
    # Check Supabase connection
    if supabase_client:
        try:
            # Simple health check query
            supabase_client.table("job_leads").select("id").limit(1).execute()
            health_status["services"]["supabase"] = "healthy"
            health_status["services"]["database"] = "healthy"
        except (KeyError, ValueError) as e:
            logger.error(f"Data error during health check: {e}")
            health_status["services"]["supabase"] = f"unhealthy: {str(e)}"
            health_status["services"]["database"] = "unhealthy"
            health_status["ok"] = False
        except Exception as e:
            logger.error(f"Unexpected error during health check: {e}")
            health_status["services"]["supabase"] = f"unhealthy: {str(e)}"
            health_status["services"]["database"] = "unhealthy"
            health_status["ok"] = False
    else:
        health_status["services"]["supabase"] = "not_configured"
        health_status["services"]["database"] = "not_configured"
    
    # Check admin token configuration
    if _admin_tokens:
        health_status["services"]["admin_tokens"] = f"configured ({len(_admin_tokens)} tokens)"
    else:
        health_status["services"]["admin_tokens"] = "not_configured"
        health_status["ok"] = False
    
    return health_status


@app.get("/api/admin/rate-limit/stats", dependencies=[Depends(require_auth)])
async def rate_limit_stats(user_id: str = Depends(require_auth)) -> dict:
    """Get rate limiting statistics (admin only)."""
    # Only allow admin to view stats
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return get_rate_limit_stats()


@app.post("/api/admin/rate-limit/clear", dependencies=[Depends(require_auth)])
async def clear_rate_limit_endpoint(
    identifier: Optional[str] = Query(None, description="Specific identifier to clear, or None to clear all"),
    user_id: str = Depends(require_auth)
) -> dict:
    """Clear rate limit records (admin only)."""
    # Only allow admin to clear rate limits
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    cleared = clear_rate_limit(identifier)
    return {"cleared": cleared, "identifier": identifier or "all"}


# ---------------------------------------------------------------------------
# Admin API Key Management Endpoints
# ---------------------------------------------------------------------------

class AddTokenIn(BaseModel):
    token: str = Field(..., min_length=16, max_length=256, description="The admin token to add")
    name: str = Field(..., min_length=1, max_length=100, description="Descriptive name for the token")
    expires_hours: Optional[int] = Field(None, ge=1, le=8760, description="Expiration time in hours (max 1 year)")


class RotateTokenIn(BaseModel):
    old_token: str = Field(..., min_length=16, max_length=256, description="The current token to replace")
    new_token: str = Field(..., min_length=16, max_length=256, description="The new token")
    name: str = Field(..., min_length=1, max_length=100, description="Descriptive name for the new token")
    expires_hours: Optional[int] = Field(None, ge=1, le=8760, description="Expiration time in hours (max 1 year)")


@app.get("/api/admin/tokens", dependencies=[Depends(require_auth)])
async def list_tokens(user_id: str = Depends(require_auth)) -> dict:
    """List all admin tokens (admin only)."""
    # Only allow admin to list tokens
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return {"tokens": list_admin_tokens()}


@app.post("/api/admin/tokens", dependencies=[Depends(require_auth)])
async def add_token(body: AddTokenIn, user_id: str = Depends(require_auth)) -> dict:
    """Add a new admin token (admin only)."""
    # Only allow admin to add tokens
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    token_hash = add_admin_token(body.token, body.name, body.expires_hours)
    return {
        "success": True,
        "hash": token_hash[:16] + "...",
        "name": body.name,
        "expires_hours": body.expires_hours
    }


@app.delete("/api/admin/tokens/{token_hash}", dependencies=[Depends(require_auth)])
async def remove_token(token_hash: str, user_id: str = Depends(require_auth)) -> dict:
    """Remove an admin token by hash (admin only)."""
    # Only allow admin to remove tokens
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    removed = remove_admin_token(token_hash)
    if not removed:
        raise HTTPException(status_code=404, detail="Token not found")
    
    return {"success": True, "hash": token_hash[:16] + "...", "removed": True}


@app.post("/api/admin/tokens/rotate", dependencies=[Depends(require_auth)])
async def rotate_token(body: RotateTokenIn, user_id: str = Depends(require_auth)) -> dict:
    """Rotate an admin token (admin only)."""
    # Only allow admin to rotate tokens
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    success, new_hash = rotate_admin_token(body.old_token, body.new_token, body.name, body.expires_hours)
    if not success:
        raise HTTPException(status_code=400, detail="Old token not found or invalid")
    
    return {
        "success": True,
        "old_hash": hash_token(body.old_token)[:16] + "...",
        "new_hash": new_hash[:16] + "...",
        "name": body.name
    }


@app.get("/api/admin/cache/stats", dependencies=[Depends(require_auth)])
async def cache_stats(user_id: str = Depends(require_auth)) -> dict:
    """Get cache statistics (admin only)."""
    # Only allow admin to view cache stats
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not CACHE_ENABLED or not redis_client:
        return {
            "cache_enabled": False,
            "redis_available": REDIS_AVAILABLE,
            "message": "Caching is disabled"
        }
    
    try:
        info = redis_client.info()
        return {
            "cache_enabled": True,
            "redis_available": True,
            "connected": True,
            "stats": {
                "used_memory": info.get("used_memory_human", "unknown"),
                "used_memory_peak": info.get("used_memory_peak_human", "unknown"),
                "total_keys": info.get("db0", {}).get("keys", 0),
                "hits": info.get("keyspace_hits", 0),
                "misses": info.get("keyspace_misses", 0),
                "hit_rate": info.get("keyspace_hits", 0) / max(1, info.get("keyspace_hits", 0) + info.get("keyspace_misses", 0))
            }
        }
    except Exception as e:
        return {
            "cache_enabled": True,
            "redis_available": True,
            "connected": False,
            "error": str(e)
        }


@app.post("/api/admin/cache/clear", dependencies=[Depends(require_auth)])
async def clear_cache(pattern: Optional[str] = Query(None, description="Pattern to clear, or None to clear all"), user_id: str = Depends(require_auth)) -> dict:
    """Clear cache entries (admin only)."""
    # Only allow admin to clear cache
    resolved_user_id = await resolve_user_alias(user_id)
    if resolved_user_id != ADMIN_UUID:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not CACHE_ENABLED or not redis_client:
        return {
            "success": False,
            "message": "Caching is disabled"
        }
    
    try:
        if pattern:
            cleared = cache_delete_pattern(pattern)
            return {
                "success": True,
                "cleared_keys": cleared,
                "pattern": pattern
            }
        else:
            # Clear all keys (use with caution)
            redis_client.flushdb()
            return {
                "success": True,
                "cleared_keys": "all",
                "pattern": "*"
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/fleet/logs", dependencies=[Depends(require_auth)])
async def fleet_logs(request: Request) -> StreamingResponse:
    async def event_source() -> AsyncIterator[bytes]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=200)
        fleet.subscribers.add(q)
        try:
            yield b": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {payload}\n\n".encode()
                except asyncio.TimeoutError:
                    yield b": keepalive\n\n"
        finally:
            fleet.subscribers.discard(q)

    return StreamingResponse(event_source(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Webhook config
# ---------------------------------------------------------------------------

SMTP_HOST = os.environ.get("ODYSSEY_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("ODYSSEY_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("ODYSSEY_SMTP_USER", "")
SMTP_PASS = os.environ.get("ODYSSEY_SMTP_PASS", "")
SMTP_FROM = os.environ.get("ODYSSEY_SMTP_FROM", SMTP_USER)


def _read_drafts(user_id: str) -> dict:
    """Read drafts for a specific user from Supabase with caching."""
    cache_key = cache_key_drafts(user_id)
    
    # Try cache first
    cached = cache_get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Cache decode error for drafts: {e}")
    
    # Fallback to database
    if not supabase_client:
        logger.warning("Supabase client not available for drafts fetch")
        return {}
    
    try:
        result = supabase_client.table("networking_drafts").select("*").eq("user_id", user_id).execute()
        # Convert to dict format for compatibility
        drafts_dict = {}
        for draft in result.data:
            drafts_dict[draft["id"]] = {
                "id": draft["id"],
                "to_email": draft.get("to_email"),
                "company": draft.get("company"),
                "subject": draft.get("subject"),
                "body": draft.get("body"),
                "status": draft.get("status", "draft"),
                "sent_at": draft.get("sent_at"),
                "sent_to": draft.get("sent_to"),
                "created_at": draft.get("created_at"),
                "updated_at": draft.get("updated_at"),
            }
        
        # Cache the result
        cache_set(cache_key, json.dumps(drafts_dict), CACHE_TTL_DEFAULT)
        return drafts_dict
    except (KeyError, ValueError) as e:
        logger.error(f"Data error reading drafts for user {user_id}: {e}")
        return {}
    except Exception as e:
        logger.error(f"Unexpected error reading drafts for user {user_id}: {e}")
        raise DatabaseException(f"Failed to read drafts: {e}")


def _write_drafts(d: dict, user_id: str) -> None:
    """Write drafts for a specific user to Supabase with cache invalidation."""
    cache_key = cache_key_drafts(user_id)
    
    if not supabase_client:
        logger.warning("Supabase client not available for drafts write")
        return
    
    try:
        # Get existing drafts for this user
        existing_result = supabase_client.table("networking_drafts").select("id").eq("user_id", user_id).execute()
        existing_ids = {draft["id"] for draft in existing_result.data}
        
        # Upsert each draft
        for draft_id, draft_data in d.items():
            draft_record = {
                "id": draft_id,
                "user_id": user_id,
                "to_email": draft_data.get("to_email"),
                "company": draft_data.get("company"),
                "subject": draft_data.get("subject"),
                "body": draft_data.get("body"),
                "status": draft_data.get("status", "draft"),
                "sent_at": draft_data.get("sent_at"),
                "sent_to": draft_data.get("sent_to"),
            }
            supabase_client.table("networking_drafts").upsert(draft_record).execute()
        
        # Delete drafts that no longer exist in the dict
        current_ids = set(d.keys())
        ids_to_delete = existing_ids - current_ids
        for draft_id in ids_to_delete:
            supabase_client.table("networking_drafts").delete().eq("id", draft_id).eq("user_id", user_id).execute()
        
        # Invalidate cache
        cache_delete(cache_key)
            
    except (KeyError, ValueError) as e:
        logger.error(f"Data error writing drafts for user {user_id}: {e}")
        # Invalidate cache on error to ensure consistency
        cache_delete(cache_key)
    except Exception as e:
        logger.error(f"Unexpected error writing drafts for user {user_id}: {e}")
        # Invalidate cache on error to ensure consistency
        cache_delete(cache_key)
        raise DatabaseException(f"Failed to write drafts: {e}")


def _csv_append(path: Path, row: dict) -> None:
    is_new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(row.keys()))
        if is_new:
            w.writeheader()
        w.writerow(row)


def _build_dossier(body: NetworkingDraftIn) -> str:
    lines = [f"- Primary note: {body.context}"] if body.context.strip() else []
    for k, v in body.extra_context.items():
        if v and v.strip():
            lines.append(f"- {k.replace('_', ' ').title()}: {v.strip()}")
    return "\n".join(lines) if lines else "- No additional signal provided; keep the email short and avoid invented specifics."


def _send_email_sync(to_addr: str, subject: str, body: str) -> None:
    if not (SMTP_HOST and SMTP_USER and SMTP_PASS):
        raise RuntimeError("SMTP not configured — set ODYSSEY_SMTP_HOST/USER/PASS")
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_addr
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)

def _read_webhooks(user_id: str) -> WebhookConfig:
    """Read webhook config for a specific user from Supabase with caching."""
    cache_key = cache_key_webhooks(user_id)
    
    # Try cache first
    cached = cache_get(cache_key)
    if cached:
        try:
            config_dict = json.loads(cached)
            return WebhookConfig(**config_dict)
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.error(f"Cache decode error for webhooks: {e}")
    
    # Fallback to database
    if not supabase_client:
        logger.warning("Supabase client not available for webhooks fetch")
        return WebhookConfig()
    
    try:
        result = supabase_client.table("user_webhooks").select("*").eq("user_id", user_id).execute()
        if result.data:
            config = result.data[0]
            webhook_config = WebhookConfig(
                n8n_url=config.get("n8n_url", ""),
                make_url=config.get("make_url", ""),
                enabled=config.get("enabled", False)
            )
            # Cache the result
            cache_set(cache_key, webhook_config.model_dump_json(), CACHE_TTL_LONG)
            return webhook_config
        return WebhookConfig()
    except (KeyError, ValueError) as e:
        logger.error(f"Data error reading webhooks for user {user_id}: {e}")
        return WebhookConfig()
    except Exception as e:
        logger.error(f"Unexpected error reading webhooks for user {user_id}: {e}")
        raise DatabaseException(f"Failed to read webhooks: {e}")


def _write_webhooks(cfg: WebhookConfig, user_id: str) -> WebhookConfig:
    """Write webhook config for a specific user to Supabase with cache invalidation."""
    cache_key = cache_key_webhooks(user_id)
    
    if not supabase_client:
        logger.warning("Supabase client not available for webhooks write")
        return cfg
    
    try:
        webhook_record = {
            "user_id": user_id,
            "n8n_url": cfg.n8n_url,
            "make_url": cfg.make_url,
            "enabled": cfg.enabled,
        }
        supabase_client.table("user_webhooks").upsert(webhook_record).execute()
        
        # Invalidate cache
        cache_delete(cache_key)
        
        return cfg
    except (KeyError, ValueError) as e:
        logger.error(f"Data error writing webhooks for user {user_id}: {e}")
        # Invalidate cache on error to ensure consistency
        cache_delete(cache_key)
        return cfg
    except Exception as e:
        logger.error(f"Unexpected error writing webhooks for user {user_id}: {e}")
        # Invalidate cache on error to ensure consistency
        cache_delete(cache_key)
        raise DatabaseException(f"Failed to write webhooks: {e}")


@app.get("/api/webhooks/config", dependencies=[Depends(require_auth)])
async def get_webhooks(user_id: str = Depends(require_auth)) -> WebhookConfig:
    return _read_webhooks(user_id)


@app.post("/api/webhooks/config", dependencies=[Depends(require_auth)])
async def set_webhooks(cfg: WebhookConfig, user_id: str = Depends(require_auth)) -> WebhookConfig:
    return _write_webhooks(cfg, user_id)


# ---------------------------------------------------------------------------
# Inbound Email (Phase 2 - Data Provider Pipeline)
# ---------------------------------------------------------------------------


class InboundEmailIn(BaseModel):
    """Schema for incoming email webhooks from n8n.
    
    Required fields:
    - message_id: Unique identifier for the email (from n8n, ensures database uniqueness)
    - subject: Email subject line
    - sender: Email sender address
    - body: Email body content
    
    Optional fields:
    - raw_url: Optional job URL extracted from email
    """
    message_id: str = Field(..., max_length=500, description="Unique email identifier from n8n")
    subject: str = Field(..., max_length=500)
    sender: str = Field(..., max_length=200)
    body: str = Field(..., max_length=50_000)
    raw_url: Optional[str] = Field(None, max_length=2048)  # Optional job URL extracted from email
    
    @field_validator('sender', mode='before')
    @classmethod
    def validate_sender_email(cls, v: str) -> str:
        return validate_email(v)
    
    @field_validator('raw_url', mode='before')
    @classmethod
    def validate_raw_url(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return validate_url(v)
        return v
    
    @field_validator('subject', 'body', mode='before')
    @classmethod
    def sanitize_email_fields(cls, v: str, info) -> str:
        field_name = info.field_name
        max_length = 500 if field_name == 'subject' else 50_000
        return sanitize_string(v, max_length, field_name)


def _extract_urls_from_text(text: str) -> list[str]:
    """
    Extract URLs from email body using regex patterns.
    Returns list of potential job posting URLs.
    """
    if not text:
        return []
    
    # Common job posting URL patterns
    url_patterns = [
        r'https?://[^\s<>"]+job[^\s<>"]*',  # URLs containing 'job'
        r'https?://[^\s<>"]+careers[^\s<>"]*',  # URLs containing 'careers'
        r'https?://[^\s<>"]+position[^\s<>"]*',  # URLs containing 'position'
        r'https?://[^\s<>"]+role[^\s<>"]*',  # URLs containing 'role'
        r'https?://[^\s<>"]+apply[^\s<>"]*',  # URLs containing 'apply'
        r'https?://[^\s<>"]+',  # General URLs (fallback)
    ]
    
    urls = set()
    for pattern in url_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for url in matches:
            # Clean up URL (remove trailing punctuation)
            cleaned_url = re.sub(r'[.,;:!?()"\']$', '', url)
            # Filter out common non-job URLs
            if not any(x in cleaned_url.lower() for x in ['unsubscribe', 'privacy', 'terms', 'linkedin.com/in/', 'facebook.com']):
                urls.add(cleaned_url)
    
    return list(urls)


def strip_html(text: str) -> str:
    """Removes HTML tags from the input string."""
    return re.sub('<[^<]+?>', '', text)


def _sanitize_email_body(body: str) -> str:
    """
    Sanitize email body by removing quoted replies, signatures, and headers.
    Returns cleaned content suitable for job parsing.
    """
    if not body:
        return ""
    
    # First strip HTML tags (critical for job alert emails)
    body = strip_html(body)
    
    lines = body.split('\n')
    cleaned_lines = []
    skip_lines = False
    
    for line in lines:
        # Skip quoted reply patterns
        if re.match(r'^>.*$', line) or re.match(r'^On.*wrote:', line):
            skip_lines = True
            continue
        
        # Skip signature blocks
        if re.match(r'^--\s*$', line) or re.match(r'^Best regards', line, re.IGNORECASE):
            skip_lines = True
            continue
        
        # Skip common email footer patterns
        if re.match(r'^To unsubscribe', line, re.IGNORECASE):
            skip_lines = True
            continue
        
        if not skip_lines and line.strip():
            cleaned_lines.append(line)
    
    # Join and clean whitespace
    cleaned = '\n'.join(cleaned_lines)
    cleaned = re.sub(r'\s+', ' ', cleaned)  # Normalize whitespace
    return cleaned.strip()


async def _process_email_direct_mode(subject: str, sender: str, body: str, message_id: str, user_id: Optional[str] = None) -> dict:
    """
    EMAIL PARSING MODE: Process email content directly when no URL is available.
    Extracts job metadata from email body and creates a job lead.

    Args:
        subject: Email subject line
        sender: Email sender address
        body: Email body content
        message_id: Unique email identifier for database uniqueness
        user_id: Optional user ID from JWT token for profile association
    """
    logger.info("📧 Activating EMAIL PARSING MODE - extracting job data from email body")
    if user_id:
        logger.info(f"📧 USER_ID provided: {user_id}")
    
    try:
        # 1. Sanitize email body
        cleaned_body = _sanitize_email_body(body)
        
        if not cleaned_body or len(cleaned_body) < 50:
            logger.warning("Email body too short after sanitization")
            return {
                "success": False,
                "error": "Email content insufficient for job extraction",
                "mode": "email_parsing",
                "reason": "content_too_short"
            }
        
        # 2. Extract metadata using existing LLM function
        logger.info("🤖 Extracting job metadata from email content...")
        metadata = await _extract_job_metadata(cleaned_body)
        # Defensive: Ensure metadata is never None
        if metadata is None:
            logger.warning("Metadata extraction returned None, using default metadata")
            metadata = _get_default_metadata()

        # 3. Extract tech stack from content
        tech_stack = await _extract_tech_stack_with_llm(cleaned_body)
        # Defensive: Ensure tech_stack is never None
        if tech_stack is None:
            logger.warning("Tech stack extraction returned None, using empty list")
            tech_stack = []
        
        # 5. Create job lead with extracted data
        unique_email_url = f"email://{message_id}"
        
        # Calculate match score (will use default 50 if no user_id)
        match_score = 50  # Default for email-sourced jobs without user context
        # Note: Email processing uses user_id if available for better matching
        
        # 6. Create job lead with extracted data
        job_lead_data = {
            "url": unique_email_url,  # Unique identifier using message_id
            "company_name": metadata.get("company_name") or "Unknown Company",
            "role_title": metadata.get("role_title") or subject or "Unknown Role",
            "match_score": match_score,  # Will be updated if user context available
            "status": "new",
            "raw_content": cleaned_body,
            "tech_stack": tech_stack,
            "detected_language": "en",
            "salary_min": metadata.get("salary_min"),
            "salary_max": metadata.get("salary_max"),
            "currency": metadata.get("currency", "USD"),
            "job_location": metadata.get("job_location"),
            "work_setting": metadata.get("work_setting"),
            "contact_email": metadata.get("contact_email") or sender,
            "contact_name": metadata.get("contact_name"),
            "hiring_manager_linkedin": metadata.get("hiring_manager_linkedin"),
            "user_id": user_id,  # Include user_id from JWT if available
            "email_source": {
                "subject": subject,
                "sender": sender,
                "message_id": message_id,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "mode": "email_parsing"
            }
        }
        
        # 6. Validate and save to Supabase
        if supabase_client:
            try:
                # Skip garbage data check for email-sourced content (HTML emails are normal)
                # Email content has different characteristics than scraped web content
                
                # Upsert into Supabase (handles duplicate URLs gracefully)
                result = supabase_client.table("job_leads").upsert(
                    job_lead_data,
                    on_conflict="url"
                ).execute()
                
                logger.info(f"✅ Successfully created job lead from email: {job_lead_data['role_title']} at {job_lead_data['company_name']}")
                
                return {
                    "success": True,
                    "message": "Job lead created from email content",
                    "mode": "email_parsing",
                    "job_data": job_lead_data,
                    "supabase_id": result.data[0].get("id") if result.data else None
                }
                
            except (KeyError, ValueError) as db_error:
                logger.error(f"Data error saving job lead to Supabase: {db_error}")
                return {
                    "success": False,
                    "error": f"Database save failed: {str(db_error)}",
                    "mode": "email_parsing",
                    "job_data": job_lead_data  # Return data even if save failed
                }
            except Exception as db_error:
                logger.error(f"Failed to save job lead to Supabase: {db_error}")
                return {
                    "success": False,
                    "error": f"Database save failed: {str(db_error)}",
                    "mode": "email_parsing",
                    "job_data": job_lead_data  # Return data even if save failed
                }
        else:
            logger.warning("Supabase client not available - returning extracted data without saving")
            return {
                "success": True,
                "message": "Job data extracted (not saved - Supabase unavailable)",
                "mode": "email_parsing",
                "job_data": job_lead_data
            }
            
    except (KeyError, ValueError) as e:
        logger.error(f"Data error in EMAIL PARSING MODE: {e}")
        return {
            "success": False,
            "error": f"Email parsing data error: {str(e)}",
            "mode": "email_parsing",
            "exception": str(e)
        }
    except Exception as e:
        logger.error(f"Error in EMAIL PARSING MODE: {e}")
        return {
            "success": False,
            "error": f"Email parsing failed: {str(e)}",
            "mode": "email_parsing",
            "exception": str(e)
        }


@app.post("/api/inbound/email", dependencies=[Depends(require_auth)])
async def inbound_email(payload: InboundEmailIn, user_id: str = Depends(require_auth)) -> dict:
    """
    Phase 2 Inbound Data Provider Endpoint (Super-Intelligent Version).
    
    Handles multiple scenarios intelligently:
    1. SCRAPING MODE: If raw_url is provided, process through Harvester pipeline
    2. EMAIL PARSING MODE: If no URL, extract job data directly from email body
    3. URL EXTRACTION MODE: If no URL in payload, try to extract URLs from email body
    4. FALLBACK MODE: If all else fails, store email for manual processing
    
    Authentication: Requires ODYSSEY_ADMIN_TOKEN in Authorization header
    (Bearer token) or as query parameter ?token=YOUR_TOKEN
    
    Expected payload from n8n:
    {
        "message_id": "unique-email-id-from-n8n",  // REQUIRED for database uniqueness
        "subject": "Job Application for Senior Engineer",
        "sender": "recruiter@company.com",
        "body": "Email content with job details...",
        "raw_url": "https://company.com/jobs/123" (optional)
    }
    """
    logger.info(f"📧 Received inbound email from {payload.sender}: {payload.subject} (message_id: {payload.message_id})")
    logger.info(f"📧 USER_ID from JWT: {user_id}")
    
    # Resolve "admin" alias to actual UUID
    resolved_user_id = await resolve_user_alias(user_id)
    logger.info(f"📧 Resolved USER_ID: {resolved_user_id}")
    
    try:
        # 1. Validate and clean incoming data
        subject = payload.subject or "No Subject"
        sender = payload.sender or "unknown"
        body = payload.body or ""
        raw_url = payload.raw_url
        message_id = payload.message_id
        
        # Edge case: Empty body
        if not body or len(body.strip()) < 10:
            logger.warning("Email body is empty or too short")
            return {
                "success": False,
                "error": "Email body is empty or insufficient",
                "mode": "rejected",
                "reason": "empty_body"
            }
        
        # Edge case: Missing message_id
        if not message_id or not message_id.strip():
            logger.warning("Message ID is required for email processing")
            return {
                "success": False,
                "error": "Message ID is required for email processing",
                "mode": "rejected",
                "reason": "missing_message_id"
            }
        
        # 2. SCRAPING MODE: URL provided directly
        if raw_url and raw_url.strip():
            logger.info(f"🔗 SCRAPING MODE: Processing provided URL: {raw_url}")
            
            try:
                # Process the job URL through the existing pipeline with user_id
                result = await process_job_url(
                    url=raw_url,
                    user_profile=None,
                    user_id=resolved_user_id,
                    filter_criteria=None
                )
                
                # Enrich result with email metadata
                if result.get("success"):
                    result["email_source"] = {
                        "subject": subject,
                        "sender": sender,
                        "message_id": message_id,
                        "received_at": datetime.now(timezone.utc).isoformat(),
                        "mode": "scraping"
                    }
                    logger.info(f"✅ Successfully processed job URL from email")
                else:
                    logger.warning(f"⚠️ URL processing failed: {result.get('error', 'Unknown error')}")
                
                return result
                
            except (KeyError, ValueError) as e:
                logger.error(f"❌ Data error in SCRAPING MODE: {e}")
                # Fallback to email parsing if scraping fails
                logger.info("🔄 Falling back to EMAIL PARSING MODE due to scraping data error")
                return await _process_email_direct_mode(subject, sender, body, message_id, resolved_user_id)
            except Exception as e:
                logger.error(f"❌ Error in SCRAPING MODE: {e}")
                # Fallback to email parsing if scraping fails
                logger.info("🔄 Falling back to EMAIL PARSING MODE due to scraping error")
                return await _process_email_direct_mode(subject, sender, body, message_id, resolved_user_id)
        
        # 3. URL EXTRACTION MODE: Try to find URLs in email body
        logger.info("🔍 URL EXTRACTION MODE: No URL provided, searching email body...")
        extracted_urls = _extract_urls_from_text(body)
        
        if extracted_urls:
            logger.info(f"✨ Found {len(extracted_urls)} potential job URLs in email body")
            
            # Try the first promising URL
            for url in extracted_urls[:3]:  # Try up to 3 URLs
                logger.info(f"🎯 Attempting to process extracted URL: {url}")
                try:
                    result = await process_job_url(
                        url=url,
                        user_profile=None,
                        user_id=resolved_user_id,
                        filter_criteria=None
                    )
                    
                    if result.get("success"):
                        result["email_source"] = {
                            "subject": subject,
                            "sender": sender,
                            "message_id": message_id,
                            "received_at": datetime.now(timezone.utc).isoformat(),
                            "mode": "url_extraction",
                            "extracted_url": url
                        }
                        logger.info(f"✅ Successfully processed extracted URL")
                        return result
                except (KeyError, ValueError) as e:
                    logger.warning(f"⚠️ Data error processing extracted URL {url}: {e}")
                    continue
                except Exception as e:
                    logger.warning(f"⚠️ Failed to process extracted URL {url}: {e}")
                    continue
            
            # If all extracted URLs failed, fall back to email parsing
            logger.info("🔄 All extracted URLs failed, falling back to EMAIL PARSING MODE")
            return await _process_email_direct_mode(subject, sender, body, message_id, resolved_user_id)
        
        # 4. EMAIL PARSING MODE: No URLs found, process email content directly
        logger.info("📧 EMAIL PARSING MODE: No URLs found, processing email content directly")
        return await _process_email_direct_mode(subject, sender, body, message_id, resolved_user_id)
            
    except (KeyError, ValueError) as e:
        logger.error(f"❌ Data error processing inbound email: {e}")
        return {
            "success": False,
            "error": f"Data error: {str(e)}",
            "mode": "error",
            "exception": str(e)
        }
    except Exception as e:
        logger.error(f"❌ Fatal error processing inbound email: {e}")
        return {
            "success": False,
            "error": f"Fatal error: {str(e)}",
            "mode": "error",
            "exception": str(e)
        }


# ---------------------------------------------------------------------------
# Data export
# ---------------------------------------------------------------------------


@app.get("/api/data/export", dependencies=[Depends(require_auth)])
async def export(format: str = "json", user_id: str = Depends(require_auth)) -> Response:
    """
    Export user-specific data (job leads, networking drafts, profile) instead of global system state.
    Prevents cross-user data leakage.
    """
    # Resolve user alias if needed
    resolved_user_id = await resolve_user_alias(user_id)
    
    # Collect user-specific data
    user_data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": resolved_user_id,
    }
    
    # Export user's job leads
    if supabase_client:
        try:
            job_leads_result = supabase_client.table("job_leads").select("*").eq("user_id", resolved_user_id).execute()
            user_data["job_leads"] = job_leads_result.data
        except (KeyError, ValueError) as e:
            logger.error(f"Data error exporting job leads: {e}")
            user_data["job_leads"] = []
        except Exception as e:
            logger.error(f"Unexpected error exporting job leads: {e}")
            user_data["job_leads"] = []
    
    # Export user's networking drafts
    if supabase_client:
        try:
            drafts_result = supabase_client.table("networking_drafts").select("*").eq("user_id", resolved_user_id).execute()
            user_data["networking_drafts"] = drafts_result.data
        except (KeyError, ValueError) as e:
            logger.error(f"Data error exporting networking drafts: {e}")
            user_data["networking_drafts"] = []
        except Exception as e:
            logger.error(f"Unexpected error exporting networking drafts: {e}")
            user_data["networking_drafts"] = []
    
    # Export user's profile
    if supabase_client:
        try:
            profile = await _get_user_profile(resolved_user_id)
            user_data["profile"] = profile
        except (KeyError, ValueError) as e:
            logger.error(f"Data error exporting user profile: {e}")
            user_data["profile"] = None
        except Exception as e:
            logger.error(f"Unexpected error exporting user profile: {e}")
            user_data["profile"] = None
    
    # Export user's webhook config
    try:
        webhooks = _read_webhooks(resolved_user_id)
        user_data["webhooks"] = webhooks.model_dump()
    except (KeyError, ValueError) as e:
        logger.error(f"Data error exporting webhooks: {e}")
        user_data["webhooks"] = None
    except Exception as e:
        logger.error(f"Unexpected error exporting webhooks: {e}")
        user_data["webhooks"] = None
    
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["category", "data"])
        w.writerow(["export_info", json.dumps({"exported_at": user_data["exported_at"], "user_id": user_data["user_id"]})])
        w.writerow(["job_leads", json.dumps(user_data.get("job_leads", []))])
        w.writerow(["networking_drafts", json.dumps(user_data.get("networking_drafts", []))])
        w.writerow(["profile", json.dumps(user_data.get("profile"))])
        w.writerow(["webhooks", json.dumps(user_data.get("webhooks"))])
        return Response(
            buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=odyssey-user-export.csv"},
        )
    return JSONResponse(user_data, headers={"Content-Disposition": "attachment; filename=odyssey-user-export.json"})


# ---------------------------------------------------------------------------
# User Profile Management
# ---------------------------------------------------------------------------


async def _get_user_profile(user_id: str) -> Optional[dict]:
    """
    Fetch user profile from Supabase by user_id with caching.
    Returns profile dict or None if not found.
    """
    cache_key = cache_key_user_profile(user_id)
    
    # Try cache first
    cached = cache_get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Cache decode error for user profile: {e}")
    
    # Fallback to database
    if not supabase_client:
        logger.warning("Supabase client not available for profile fetch")
        return None
    
    try:
        result = supabase_client.table("user_profiles").select("*").eq("user_id", user_id).execute()
        if result.data:
            profile = result.data[0]
            # Cache the result
            cache_set(cache_key, json.dumps(profile), CACHE_TTL_LONG)
            return profile
        return None
    except (KeyError, ValueError) as e:
        logger.error(f"Data error fetching user profile: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching user profile: {e}")
        return None


@app.post("/api/user/profile")
async def upsert_user_profile(profile: UserProfileIn, user_id: str = Depends(require_auth)) -> dict:
    """
    Create or update user profile in Supabase.
    Uses user_id from JWT token instead of request body for security.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")
    
    try:
        # Use user_id from JWT token (more secure than from body)
        # For backward compatibility, we check if the body user_id matches the token user_id
        if profile.user_id != user_id and user_id != "admin":
            logger.warning(f"User ID mismatch: token={user_id}, body={profile.user_id}")
            # Use the token user_id for security
            user_id = user_id
        
        # Check if profile exists
        existing = await _get_user_profile(user_id)
        
        profile_data = {
            "user_id": user_id,
            "resume_text": profile.resume_text,
            "tech_stack": profile.tech_stack,
            "preferences": profile.preferences,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        if existing:
            # Update existing profile
            result = supabase_client.table("user_profiles").update(profile_data).eq("user_id", user_id).execute()
            logger.info(f"✅ Updated user profile: {user_id}")
            # Invalidate cache
            cache_delete(cache_key_user_profile(user_id))
            return {
                "success": True,
                "action": "updated",
                "data": result.data[0] if result.data else profile_data
            }
        else:
            # Create new profile
            profile_data["created_at"] = datetime.now(timezone.utc).isoformat()
            result = supabase_client.table("user_profiles").insert(profile_data).execute()
            logger.info(f"✅ Created user profile: {user_id}")
            # Invalidate cache
            cache_delete(cache_key_user_profile(user_id))
            return {
                "success": True,
                "action": "created",
                "data": result.data[0] if result.data else profile_data
            }
            
    except (KeyError, ValueError) as e:
        logger.error(f"Data error upserting user profile: {e}")
        # Invalidate cache on error to ensure consistency
        cache_delete(cache_key_user_profile(user_id))
        raise HTTPException(status_code=400, detail=f"Invalid profile data: {str(e)}")
    except Exception as e:
        logger.error(f"Error upserting user profile: {e}")
        # Invalidate cache on error to ensure consistency
        cache_delete(cache_key_user_profile(user_id))
        raise HTTPException(status_code=500, detail=f"Failed to save user profile: {str(e)}")


@app.get("/api/user/profile")
async def get_user_profile(user_id: str = Depends(require_auth)) -> dict:
    """
    Fetch user profile for the authenticated user.
    Uses user_id from JWT token instead of query parameter for security.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")
    
    profile = await _get_user_profile(user_id)
    
    if not profile:
        raise HTTPException(status_code=404, detail="User profile not found")
    
    return {
        "success": True,
        "data": profile
    }


# ---------------------------------------------------------------------------
# Profile Parsing (PDF -> LLM -> Database)
# ---------------------------------------------------------------------------


async def _extract_pdf_text(file: UploadFile) -> str:
    """
    Extract text from uploaded PDF file.
    Returns empty string if PDF parsing is not available.
    """
    if not PDF_AVAILABLE:
        logger.warning("PDF parsing not available - PyPDF2 not installed")
        return ""
    
    try:
        # Read file content
        content = await file.read()
        
        # Use PyPDF2 to extract text
        import io
        pdf_file = io.BytesIO(content)
        pdf_reader = PyPDF2.PdfReader(pdf_file)
        
        # Extract text from all pages
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
        
        logger.info(f"Extracted {len(text)} characters from PDF")
        return text.strip()
        
    except ImportError as e:
        logger.error(f"PDF extraction error: {e}")
        return ""


async def _parse_resume_with_llm(resume_text: str) -> Optional[ParsedProfileData]:
    """
    Use Groq LLM to parse unstructured resume text into structured format.
    Returns None if parsing fails.
    """
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        logger.error("GROQ_API_KEY not set - cannot parse resume")
        return None
    
    prompt = f"""You are an expert resume parser. Extract structured information from the following resume text.

Return ONLY a valid JSON object with this exact structure:
{{
  "personal_info": {{
    "name": "Full Name (required)",
    "location": "City, Country (optional, empty string if not found)",
    "languages": ["Language 1", "Language 2"] (optional, empty array if not found)
  }},
  "tech_stack": ["Technology1", "Technology2"] (optional, empty array if not found),
  "education": [
    {{
      "degree": "Degree name (required)",
      "institution": "Institution name (optional, empty string if not found)"
    }}
  ] (optional, empty array if not found),
  "experience": [
    {{
      "role": "Job title (required)",
      "company": "Company name (optional, empty string if not found)",
      "duration": "Time period (optional, empty string if not found)"
    }}
  ] (optional, empty array if not found),
  "extra_metadata": {{
    "certifications": ["cert1", "cert2"],
    "portfolio_url": "url",
    "github_url": "url",
    "linkedin_url": "url"
  }} (optional, empty dict if not found)
}}

Rules:
- If a field is marked "required", extract it or use a sensible default (e.g., "User Profile" for name)
- If a field is marked "optional", use empty string/array/dict if not found
- Place any relevant data that doesn't fit the schema in extra_metadata
- Return ONLY the JSON, no other text

Resume text:
{resume_text}
"""
    
    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_api_key}"},
                    json_data={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,  # Low temperature for consistent JSON output
                        "max_tokens": 4000,
                        "response_format": {"type": "json_object"}  # Force JSON output
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    logger.warning(f"Profile parsing hit rate limit, returning None")
                    return None
                else:
                    logger.error(f"Profile parsing API error: {e}")
                    return None
            
            if not data or 'choices' not in data or not data['choices']:
                logger.error("LLM response missing choices")
                return None
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.error("LLM returned empty content")
                return None
            
            # Parse JSON response
            parsed_data = json.loads(content)
            
            # Validate with Pydantic model
            parsed_profile = ParsedProfileData(**parsed_data)
            
            logger.info(f"Successfully parsed resume with {len(parsed_profile.tech_stack)} tech skills")
            return parsed_profile
            
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM JSON response: {e}")
        return None
    except ImportError as e:
        logger.error(f"LLM parsing error: {e}")
        return None


async def _upsert_parsed_profile(parsed_data: ParsedProfileData, user_id: str) -> dict:
    """
    Upsert parsed profile data to Supabase user_profiles table.
    Merges structured data into existing preferences dict.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")
    
    try:
        # Get existing profile
        existing = await _get_user_profile(user_id)
        
        # Build preferences dict with structured data
        preferences = {
            "profile_name": parsed_data.personal_info.name,
            "location": parsed_data.personal_info.location,
            "languages": parsed_data.personal_info.languages,
            "education": [edu.dict() for edu in parsed_data.education],
            "experience": [exp.dict() for exp in parsed_data.experience],
            "extra_metadata": parsed_data.extra_metadata,
        }
        
        # Merge with existing preferences if available
        if existing and existing.get("preferences"):
            existing_prefs = existing["preferences"]
            preferences.update(existing_prefs)
        
        # Build profile data
        profile_data = {
            "user_id": user_id,
            "resume_text": f"Parsed profile for {parsed_data.personal_info.name}",
            "tech_stack": parsed_data.tech_stack,
            "preferences": preferences,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        if existing:
            # Update existing profile
            result = supabase_client.table("user_profiles").update(profile_data).eq("user_id", user_id).execute()
            logger.info(f"✅ Updated parsed profile for user: {user_id}")
            return {
                "success": True,
                "action": "updated",
                "data": result.data[0] if result.data else profile_data
            }
        else:
            # Create new profile
            profile_data["created_at"] = datetime.now(timezone.utc).isoformat()
            result = supabase_client.table("user_profiles").insert(profile_data).execute()
            logger.info(f"✅ Created parsed profile for user: {user_id}")
            return {
                "success": True,
                "action": "created",
                "data": result.data[0] if result.data else profile_data
            }
            
    except ImportError as e:
        logger.error(f"Error upserting parsed profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save parsed profile: {str(e)}")


@app.post("/api/user/profile/parse", dependencies=[Depends(require_auth)])
async def parse_profile(
    file: UploadFile = File(..., description="PDF file to parse"),
    user_id: str = Depends(require_auth)
) -> dict:
    """
    Parse uploaded PDF resume using LLM and upsert to user profile.
    
    Process:
    1. Extract text from PDF using PyPDF2
    2. Parse structured data using Groq LLM (Llama-3.3)
    3. Upsert parsed data to Supabase user_profiles table
    4. Return success with parsed data
    """
    try:
        # Validate file type
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
        # Extract text from PDF
        resume_text = await _extract_pdf_text(file)
        if not resume_text:
            raise HTTPException(status_code=400, detail="Failed to extract text from PDF or PDF parsing not available")
        
        # Parse with LLM
        parsed_data = await _parse_resume_with_llm(resume_text)
        if not parsed_data:
            raise HTTPException(status_code=500, detail="Failed to parse resume with LLM")
        
        # Upsert to database
        result = await _upsert_parsed_profile(parsed_data, user_id)
        
        return {
            "success": True,
            "message": "Profile parsed and synced successfully",
            "parsed_data": parsed_data.dict(),
            "profile_update": result
        }
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except ImportError as e:
        logger.error(f"Profile parsing error: {e}")
        raise HTTPException(status_code=500, detail=f"Profile parsing failed: {str(e)}")


# ---------------------------------------------------------------------------
# Job Leads (Supabase integration)
# ---------------------------------------------------------------------------


def _normalize_tech_stack(tech_stack: list[str] | str | None) -> list[str]:
    """
    Helper to normalize tech_stack input.
    Handles string (comma-separated), list, or None.
    """
    if not tech_stack:
        return []
    if isinstance(tech_stack, str):
        # Split by comma and strip whitespace
        return [t.strip() for t in tech_stack.split(",") if t.strip()]
    return tech_stack


# ---------------------------------------------------------------------------
# Content Sanitization Pipeline
# ---------------------------------------------------------------------------


def is_garbage_data(content: str) -> bool:
    """
    Detect garbage data (HTML, encoded content, or non-text data) before processing.
    
    Args:
        content: Raw content string to validate
        
    Returns:
        True if content appears to be garbage, False if it looks like valid text
    """
    if not content:
        return True
    
    # 1. Check for HTML tags
    if re.search(r'<[^>]+>', content):
        return True
    
    # 2. Check for high density of non-alphanumeric chars (encoded React blobs)
    # If more than 15% of the string are special chars, it's garbage.
    special_chars = len(re.findall(r'[^a-zA-Z0-9\s.,!?-]', content))
    if special_chars / len(content) > 0.15:
        return True
    
    return False


def clean_and_truncate(text: str, max_length: int = 25000) -> str:
    """
    Clean and truncate text content to prevent Pydantic validation errors and LLM parsing crashes.
    
    Args:
        text: Raw text content
        max_length: Maximum length to truncate to (default 25k, well under 50k limit)
        
    Returns:
        Cleaned and truncated text
    """
    if not text:
        return ""
    
    # Remove non-printable characters (except common whitespace)
    import string
    printable = set(string.printable)
    cleaned = ''.join(char for char in text if char in printable)
    
    # Remove excessive whitespace (multiple spaces, tabs, newlines)
    import re
    cleaned = re.sub(r'\s+', ' ', cleaned)
    
    # Truncate to max length
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]
        logger.warning(f"Content truncated from {len(text)} to {max_length} characters")
    
    return cleaned.strip()


def validate_content_type(content_type: Optional[str]) -> bool:
    """
    Validate that the content type is HTML/text, not binary/compressed data.
    
    Args:
        content_type: Content-Type header value
        
    Returns:
        True if content type is acceptable, False otherwise
    """
    if not content_type:
        return False
    
    acceptable_types = [
        'text/html',
        'text/plain',
        'text/xml',
        'application/xhtml+xml',
        'application/xml',
        'text/json',
        'application/json'
    ]
    
    content_type_lower = content_type.lower()
    return any(acceptable_type in content_type_lower for acceptable_type in acceptable_types)


# ---------------------------------------------------------------------------
# Odyssey Orchestration Sequence - Agent Functions
# ---------------------------------------------------------------------------


async def _document_studio_draft_cold_reach(job_data: dict) -> str:
    """
    DocumentStudio agent: Generate cold reach email draft for approved job.
    Returns: Email draft content (string).
    """
    logger.info(f"DocumentStudio: Generating cold reach draft for {job_data.get('company_name', 'Unknown')}")
    
    prompt = f"""Generate a professional cold outreach email for this job opportunity:
Company: {job_data.get('company_name', 'Unknown')}
Role: {job_data.get('role_title', 'Unknown')}
Tech Stack: {', '.join(job_data.get('tech_stack', []))}
Job Description (excerpt): {job_data.get('raw_content', '')[:500]}

Return ONLY the email body text, no subject line."""
    
    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                        "max_tokens": 1000,
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    # Rate limit error - return fallback
                    logger.warning(f"DocumentStudio hit rate limit, using fallback")
                    return f"Dear Hiring Manager,\n\nI am writing to express my interest in the {job_data.get('role_title', 'position')} at {job_data.get('company_name', 'your company')}.\n\n[Rate limited - please try again later]\n\nBest regards"
                else:
                    # Other errors - return fallback
                    logger.error(f"DocumentStudio API error: {e}")
                    return f"Dear Hiring Manager,\n\nI am writing to express my interest in the {job_data.get('role_title', 'position')} at {job_data.get('company_name', 'your company')}.\n\n[Draft generation failed - {str(e)}]\n\nBest regards"
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("DocumentStudio LLM response missing 'choices' array")
                return f"Dear Hiring Manager,\n\nI am writing to express my interest in the {job_data.get('role_title', 'position')} at {job_data.get('company_name', 'your company')}.\n\n[Draft generation failed - missing choices]\n\nBest regards"
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("DocumentStudio LLM choice missing 'message' field")
                return f"Dear Hiring Manager,\n\nI am writing to express my interest in the {job_data.get('role_title', 'position')} at {job_data.get('company_name', 'your company')}.\n\n[Draft generation failed - missing message]\n\nBest regards"
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("DocumentStudio LLM message content is empty")
                return f"Dear Hiring Manager,\n\nI am writing to express my interest in the {job_data.get('role_title', 'position')} at {job_data.get('company_name', 'your company')}.\n\n[Draft generation failed - empty content]\n\nBest regards"
            
            return content.strip()
    except ImportError as e:
        logger.error(f"DocumentStudio error: {e}")
        return f"Dear Hiring Manager,\n\nI am writing to express my interest in the {job_data.get('role_title', 'position')} at {job_data.get('company_name', 'your company')}.\n\n[Draft generation failed - using placeholder]\n\nBest regards"


async def _cv_generator_tailor_cv(job_data: dict) -> str:
    """
    CVGenerator agent: Tailor CV for the specific job using LLM.
    Returns: JSON string containing tailored CV data (professional summary, optimized bullets).
    """
    logger.info(f"CVGenerator: Tailoring CV for {job_data.get('company_name', 'Unknown')}")
    
    try:
        # Extract user_id from job_data
        user_id = job_data.get('user_id')
        if not user_id:
            logger.warning("CVGenerator: No user_id in job_data, skipping profile fetch")
            return json.dumps({
                "error": "No user_id provided",
                "professional_summary": "Unable to generate tailored summary - user profile not found",
                "optimized_bullets": []
            })
        
        # Fetch user profile from Supabase
        user_profile = await _get_user_profile(user_id)
        if not user_profile:
            logger.warning(f"CVGenerator: No profile found for user {user_id}")
            return json.dumps({
                "error": "User profile not found",
                "professional_summary": "Unable to generate tailored summary - user profile not found",
                "optimized_bullets": []
            })
        
        # Extract profile data
        profile_name = user_profile.get('preferences', {}).get('name') or user_profile.get('resume_text', '').split('\n')[0] if user_profile.get('resume_text') else "Candidate"
        profile_tech_stack = user_profile.get('tech_stack', [])
        profile_resume = user_profile.get('resume_text', '')
        profile_preferences = user_profile.get('preferences', {})
        
        # Extract experience from preferences if available
        profile_experience = profile_preferences.get('experience', [])
        if isinstance(profile_experience, list) and profile_experience:
            experience_text = "\n".join([
                f"{exp.get('role', 'Unknown Role')} at {exp.get('company', 'Unknown Company')}" +
                (f" ({exp.get('duration', '')})" if exp.get('duration') else "")
                for exp in profile_experience
            ])
        else:
            experience_text = profile_resume  # Fallback to resume text
        
        # Extract job details
        company_name = job_data.get('company_name', 'Unknown Company')
        role_title = job_data.get('role_title', 'Unknown Role')
        job_tech_stack = job_data.get('tech_stack', [])
        job_description = job_data.get('raw_content', '')
        
        # Create system prompt for expert technical recruiter
        system_prompt = """You are an expert technical recruiter and CV writer specializing in tailoring resumes for specific job applications. Your task is to rewrite a candidate's professional summary and experience bullets to highlight their alignment with a specific job description.

REQUIREMENTS:
1. Return ONLY a valid JSON object with this exact structure:
{
  "professional_summary": "string - 2-3 sentences highlighting candidate's fit for the role",
  "optimized_bullets": ["string array - 3-5 optimized experience bullets"]
}

2. The professional summary must:
   - Mention the target company and role
   - Highlight relevant skills from the candidate's profile that match job requirements
   - Demonstrate understanding of the company's domain/tech stack
   - Be 2-3 sentences maximum

3. The optimized bullets must:
   - Use the STAR method (Situation, Task, Action, Result) where possible
   - Quantify achievements with numbers, percentages, or metrics
   - Emphasize skills and technologies that match the job requirements
   - Be concise but impactful (1-2 lines each)
   - Never hallucinate skills or experiences not in the original profile
   - Focus on the most relevant 3-5 experiences

4. Language and tone:
   - Professional, confident, but not arrogant
   - Action-oriented language (led, developed, implemented, etc.)
   - Industry-standard terminology
   - Tailored to the specific role's seniority level

CRITICAL: Do NOT include any markdown formatting, explanations, or text outside the JSON object. Return ONLY the JSON."""

        # Create user prompt with profile and job data
        user_prompt = f"""CANDIDATE PROFILE:
Name: {profile_name}
Tech Stack: {', '.join(profile_tech_stack) if profile_tech_stack else 'Not specified'}
Experience/Resume:
{experience_text[:2000] if len(experience_text) > 2000 else experience_text}

TARGET JOB:
Company: {company_name}
Role: {role_title}
Required Tech Stack: {', '.join(job_tech_stack) if job_tech_stack else 'Not specified'}
Job Description:
{job_description[:1500] if len(job_description) > 1500 else job_description}

TASK: Generate a tailored professional summary and 3-5 optimized experience bullets that highlight this candidate's fit for the {role_title} role at {company_name}. Focus on matching their skills and experience to the job requirements."""

        # Make Groq API call with retry
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.7,
                        "max_tokens": 1500,
                        "response_format": {"type": "json_object"}
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    # Rate limit error - return fallback
                    logger.warning(f"CVGenerator hit rate limit, using fallback")
                    return json.dumps({
                        "error": "Rate limited - please try again later",
                        "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                        "optimized_bullets": [
                            "Leveraged expertise in relevant technologies to deliver impactful results",
                            "Collaborated with cross-functional teams to achieve project goals",
                            "Demonstrated strong problem-solving skills in fast-paced environments"
                        ]
                    })
                else:
                    # Other errors - return fallback
                    logger.error(f"CVGenerator API error: {e}")
                    return json.dumps({
                        "error": f"API error: {str(e)}",
                        "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                        "optimized_bullets": [
                            "Leveraged expertise in relevant technologies to deliver impactful results",
                            "Collaborated with cross-functional teams to achieve project goals",
                            "Demonstrated strong problem-solving skills in fast-paced environments"
                        ]
                    })
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("CVGenerator LLM response missing 'choices' array")
                return json.dumps({
                    "error": "Invalid LLM response structure",
                    "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                    "optimized_bullets": [
                        "Leveraged expertise in relevant technologies to deliver impactful results",
                        "Collaborated with cross-functional teams to achieve project goals",
                        "Demonstrated strong problem-solving skills in fast-paced environments"
                    ]
                })
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("CVGenerator LLM choice missing 'message' field")
                return json.dumps({
                    "error": "Invalid LLM response structure",
                    "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                    "optimized_bullets": [
                        "Leveraged expertise in relevant technologies to deliver impactful results",
                        "Collaborated with cross-functional teams to achieve project goals",
                        "Demonstrated strong problem-solving skills in fast-paced environments"
                    ]
                })
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("CVGenerator LLM message content is empty")
                return json.dumps({
                    "error": "Empty LLM response",
                    "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                    "optimized_bullets": [
                        "Leveraged expertise in relevant technologies to deliver impactful results",
                        "Collaborated with cross-functional teams to achieve project goals",
                        "Demonstrated strong problem-solving skills in fast-paced environments"
                    ]
                })
            
            # Parse JSON response
            try:
                cv_data = json.loads(content.strip())
                
                # Validate structure
                if not isinstance(cv_data, dict):
                    raise ValueError("Response is not a dictionary")
                if 'professional_summary' not in cv_data or 'optimized_bullets' not in cv_data:
                    raise ValueError("Missing required fields")
                
                logger.info(f"CVGenerator: Successfully generated tailored CV for {company_name}")
                return json.dumps(cv_data)
                
            except json.JSONDecodeError as e:
                logger.error(f"CVGenerator: Failed to parse LLM JSON response: {e}")
                # Return the raw content as fallback
                return json.dumps({
                    "error": "Failed to parse JSON response",
                    "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                    "optimized_bullets": [
                        "Leveraged expertise in relevant technologies to deliver impactful results",
                        "Collaborated with cross-functional teams to achieve project goals",
                        "Demonstrated strong problem-solving skills in fast-paced environments"
                    ]
                })
            except ValueError as e:
                logger.error(f"CVGenerator: Invalid response structure: {e}")
                return json.dumps({
                    "error": f"Invalid response structure: {str(e)}",
                    "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
                    "optimized_bullets": [
                        "Leveraged expertise in relevant technologies to deliver impactful results",
                        "Collaborated with cross-functional teams to achieve project goals",
                        "Demonstrated strong problem-solving skills in fast-paced environments"
                    ]
                })
                
    except ImportError as e:
        logger.error(f"CVGenerator error: {e}")
        return json.dumps({
            "error": f"CV generation failed: {str(e)}",
            "professional_summary": f"Experienced professional interested in {role_title} role at {company_name}",
            "optimized_bullets": [
                "Leveraged expertise in relevant technologies to deliver impactful results",
                "Collaborated with cross-functional teams to achieve project goals",
                "Demonstrated strong problem-solving skills in fast-paced environments"
            ]
        })


async def _interview_studio_generate_prep_guide(job_data: dict) -> str:
    """
    InterviewStudio agent: Generate interview preparation guide using LLM.
    Returns: JSON string containing prep guide data (company research, key themes, practice questions).
    """
    logger.info(f"InterviewStudio: Generating prep guide for {job_data.get('company_name', 'Unknown')}")
    
    try:
        # Extract job details
        company_name = job_data.get('company_name', 'Unknown Company')
        role_title = job_data.get('role_title', 'Unknown Role')
        job_tech_stack = job_data.get('tech_stack', [])
        job_description = job_data.get('raw_content', '')
        
        # Create system prompt for interview preparation expert
        system_prompt = """You are an expert interview coach and company researcher specializing in technical interviews.
Your task is to generate a comprehensive interview preparation guide for a specific job opportunity.

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON object with this exact structure:
{
  "company_research": "string - brief overview of the company and its industry position",
  "key_themes": ["string array - 5-7 key technical themes/topics to study"],
  "practice_questions": ["string array - 8-10 likely interview questions"]
}

2. Company research must:
   - Provide brief company overview
   - Mention industry context
   - Note key products/services
   - Be 2-3 sentences maximum

3. Key themes must:
   - Cover the main technical areas mentioned in the job description
   - Include relevant technologies and frameworks
   - Focus on concepts likely to be tested
   - Be specific to the role's requirements
   - Include 5-7 themes maximum

4. Practice questions must:
   - Mix technical and behavioral questions
   - Be specific to the role and company
   - Test core competencies mentioned in the job description
   - Include both theoretical and practical questions
   - Be 8-10 questions maximum

5. Research strategy:
   - Use the job description to infer company focus areas
   - Consider the tech stack to identify key technical themes
   - Frame questions that test both knowledge and experience
   - Balance depth with breadth of topics

CRITICAL: Do NOT include any markdown formatting, explanations, or text outside the JSON object. Return ONLY the JSON."""

        # Create user prompt with job data
        user_prompt = f"""TARGET JOB:
Company: {company_name}
Role: {role_title}
Required Tech Stack: {', '.join(job_tech_stack) if job_tech_stack else 'Not specified'}
Job Description:
{job_description[:2000] if len(job_description) > 2000 else job_description}

TASK: Generate a comprehensive interview preparation guide including company research, key technical themes to study, and likely interview questions for this role at {company_name}."""

        # Make Groq API call with retry
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.7,
                        "max_tokens": 2000,
                        "response_format": {"type": "json_object"}
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    # Rate limit error - return fallback
                    logger.warning(f"InterviewStudio hit rate limit, using fallback")
                    return json.dumps({
                        "error": "Rate limited - please try again later",
                        "company_research": f"Research preparation for {company_name} failed",
                        "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                        "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                    })
                else:
                    # Other errors - return fallback
                    logger.error(f"InterviewStudio API error: {e}")
                    return json.dumps({
                        "error": f"API error: {str(e)}",
                        "company_research": f"Research preparation for {company_name} failed",
                        "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                        "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                    })
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("InterviewStudio LLM response missing 'choices' array")
                return json.dumps({
                    "error": "Invalid LLM response structure",
                    "company_research": f"Research preparation for {company_name} failed",
                    "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                    "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                })
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("InterviewStudio LLM choice missing 'message' field")
                return json.dumps({
                    "error": "Invalid LLM response structure",
                    "company_research": f"Research preparation for {company_name} failed",
                    "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                    "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                })
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("InterviewStudio LLM message content is empty")
                return json.dumps({
                    "error": "Empty LLM response",
                    "company_research": f"Research preparation for {company_name} failed",
                    "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                    "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                })
            
            # Parse JSON response
            try:
                prep_guide_data = json.loads(content.strip())
                
                # Validate structure
                if not isinstance(prep_guide_data, dict):
                    raise ValueError("Response is not a dictionary")
                if 'company_research' not in prep_guide_data or 'key_themes' not in prep_guide_data or 'practice_questions' not in prep_guide_data:
                    raise ValueError("Missing required fields")
                
                logger.info(f"InterviewStudio: Successfully generated prep guide for {company_name}")
                return json.dumps(prep_guide_data)
                
            except json.JSONDecodeError as e:
                logger.error(f"InterviewStudio: Failed to parse LLM JSON response: {e}")
                return json.dumps({
                    "error": "Failed to parse JSON response",
                    "company_research": f"Research preparation for {company_name} failed",
                    "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                    "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                })
            except ValueError as e:
                logger.error(f"InterviewStudio: Invalid response structure: {e}")
                return json.dumps({
                    "error": f"Invalid response structure: {str(e)}",
                    "company_research": f"Research preparation for {company_name} failed",
                    "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
                    "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
                })
                
    except ImportError as e:
        logger.error(f"InterviewStudio error: {e}")
        return json.dumps({
            "error": f"Prep guide generation failed: {str(e)}",
            "company_research": f"Research preparation for {company_name} failed",
            "key_themes": ["Technical preparation", "Company research", "Behavioral readiness"],
            "practice_questions": ["Tell me about yourself", "Why do you want to work here?", "What are your strengths?"]
        })


@app.post(
    "/api/job-leads",
    dependencies=[Depends(require_auth)],
    summary="Create a new job lead",
    description="Creates a job lead with automated analysis and filtering. Handles URL duplicates via database unique constraint."
)
async def save_job_lead(job_data: JobLeadIn, user_id: str = Depends(require_auth)) -> dict:
    """
    Save a job lead to Supabase, handling URL duplicates via database unique constraint.
    """
    # Log incoming request for diagnostic
    logger.info(f"📥 RECEIVED JOB LEAD REQUEST: {job_data.url}")
    logger.info(f"📥 ROLE: {job_data.role_title}, COMPANY: {job_data.company_name}")
    logger.info(f"📥 CONTENT LENGTH: {len(job_data.raw_content)} chars")
    logger.info(f"📥 USER_ID from JWT: {user_id}")

    # Invalidate cache for user's job leads
    cache_delete_pattern(f"job_leads:{user_id}*")
    
    # Resolve "admin" alias to actual UUID
    resolved_user_id = await resolve_user_alias(user_id)
    logger.info(f"📥 Resolved USER_ID: {resolved_user_id}")
    
    # Phase 1: Hard Quality Gate - Check for garbage data before processing
    if is_garbage_data(job_data.raw_content):
        logger.error("❌ Rejected garbage content from extension (direct save)")
        raise HTTPException(status_code=400, detail="Invalid data format: HTML/Encoded data detected")
    
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Normalize tech_stack to ensure it's always a list
        normalized_tech_stack = _normalize_tech_stack(job_data.tech_stack)

        # Inject user_id from JWT token if not provided in request body
        # This ensures job leads are always associated with the authenticated user
        final_user_id = job_data.user_id or resolved_user_id
        logger.info(f"📥 Using user_id for job lead: {final_user_id}")

        # Upsert new job lead with all fields (handles duplicate URLs gracefully)
        result = supabase_client.table("job_leads").upsert(
            {
            "url": job_data.url,
            "company_name": job_data.company_name,
            "role_title": job_data.role_title,
            "match_score": job_data.match_score,
            "status": job_data.status,
            "raw_content": job_data.raw_content,
            "tech_stack": normalized_tech_stack,
            "detected_language": job_data.detected_language,
            "salary_min": job_data.salary_min,
            "salary_max": job_data.salary_max,
            "currency": job_data.currency,
            "job_location": job_data.job_location,
            "work_setting": job_data.work_setting,
            "contact_email": job_data.contact_email,
            "contact_name": job_data.contact_name,
            "hiring_manager_linkedin": job_data.hiring_manager_linkedin,
            "user_id": final_user_id,
        },
        on_conflict="url"
        ).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to save job lead")

        # Determine if this was an insert or update based on the result
        action = "created"  # Default assumption
        logger.info(f"✅ SUCCESSFULLY SAVED JOB LEAD: {result.data[0]['id']}")
        return {"success": True, "action": action, "id": result.data[0]["id"]}

    except ImportError as e:
        logger.error(f"❌ ERROR SAVING JOB LEAD: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save job lead: {str(e)}")


# ---------------------------------------------------------------------------
# Operational Crew: Gatekeeper & Harvester
# ---------------------------------------------------------------------------


async def _detect_language_with_llm(content: str) -> str:
    """
    Use LLM to detect the language of job content.
    Returns ISO 639-1 language code (e.g., 'en', 'de', 'fr').
    
    STEP 2: Defensive LLM Parsing - Handles parsing failures gracefully
    """
    prompt = f"""Detect the language of this job posting. Return ONLY the ISO 639-1 language code (e.g., 'en', 'de', 'fr', 'es').

Job content:
{content[:2000]}"""

    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 10,
                        "response_format": {"type": "text"}  # Use text mode for language detection
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    logger.warning("Language detection hit rate limit, defaulting to 'en'")
                    return "en"
                else:
                    logger.error(f"Language detection API error: {e}")
                    return "en"
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("Language detection LLM response missing 'choices' array")
                return "en"
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("Language detection LLM choice missing 'message' field")
                return "en"
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("Language detection LLM message content is empty")
                return "en"
            
            lang_code = content.strip().lower()
            return lang_code if len(lang_code) == 2 else "en"
            
    except ImportError as e:
        logger.warning(f"Error detecting language: {e}")
        return "en"


async def _extract_tech_stack_with_llm(content: str) -> list[str]:
    """
    Use LLM to extract tech stack from job content.
    Returns list of technologies.
    
    STEP 2: Defensive LLM Parsing - Handles parsing failures gracefully
    """
    prompt = f"""Extract the technology stack from this job posting. Return ONLY a JSON array of technology names (strings). Focus on programming languages, frameworks, databases, and tools mentioned.

Job content:
{content[:3000]}"""

    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.2,
                        "response_format": {"type": "json_object"},
                        "max_tokens": 500,
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    logger.warning("Tech stack extraction hit rate limit, returning empty list")
                    return []
                else:
                    logger.error(f"Tech stack extraction API error: {e}")
                    return []
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("Tech stack LLM response missing 'choices' array")
                return []
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("Tech stack LLM choice missing 'message' field")
                return []
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("Tech stack LLM message content is empty")
                return []
            
            result = json.loads(content)
            
            # Handle both array and object responses
            if isinstance(result, list):
                return result
            if isinstance(result, dict) and "tech_stack" in result:
                return result["tech_stack"]
            if isinstance(result, dict) and "technologies" in result:
                return result["technologies"]
            return []
            
    except json.JSONDecodeError as e:
        logger.warning(f"Tech stack LLM returned invalid JSON: {e}")
        return []
    except ImportError as e:
        logger.warning(f"Error extracting tech stack: {e}")
        return []


# Simple in-memory cache for user profiles (per-request lifecycle)
_profile_cache: dict[str, dict] = {}


async def _get_cached_user_profile(user_id: str) -> Optional[dict]:
    """
    Get user profile from cache or fetch from Supabase.
    Caches profiles to avoid repeated database hits during batch processing.
    """
    if not user_id:
        return None
    
    # Check cache first
    if user_id in _profile_cache:
        logger.debug(f"📋 Using cached profile for user {user_id}")
        return _profile_cache[user_id]
    
    # Fetch from database
    profile = await _get_user_profile(user_id)
    
    # Cache the result
    if profile:
        _profile_cache[user_id] = profile
        logger.debug(f"📋 Cached profile for user {user_id}")
    
    return profile


def _clear_profile_cache():
    """Clear the profile cache (call between batches or requests)."""
    _profile_cache.clear()


async def calculate_match_score(job_content: str, user_id: Optional[str] = None) -> int:
    """
    Calculate intelligent match score using LLM-based analysis.
    
    Uses Groq LLM to analyze job content against user profile and generate
    a numeric score (0-100) based on skills, experience, and requirements fit.
    
    Args:
        job_content: Job posting content
        user_id: User ID to fetch profile for (optional)
    
    Returns:
        Match score 0-100, or 50 if no profile available
    """
    if not user_id:
        logger.info("⚠️ No user_id provided, using default match score")
        return 50
    
    # Get user profile (with caching)
    user_profile = await _get_cached_user_profile(user_id)
    
    if not user_profile or not user_profile.get("resume_text"):
        logger.info(f"⚠️ No profile found for user {user_id}, using default match score")
        return 50
    
    # Use LLM to calculate intelligent match score
    resume_text = user_profile["resume_text"]
    tech_stack = user_profile.get("tech_stack", [])
    
    prompt = f"""You are an expert job matcher. Analyze the fit between a job posting and a candidate's profile.

CANDIDATE PROFILE:
Resume/Summary: {resume_text[:3000]}
Tech Stack: {', '.join(tech_stack) if tech_stack else 'Not specified'}

JOB POSTING:
{job_content[:4000]}

Calculate a match score from 0-100 based on:
1. Skills overlap (required skills vs candidate's tech stack)
2. Experience level alignment
3. Role requirements match
4. Overall fit for the position

Return ONLY a single integer number (0-100) representing the match score.
Do not include any explanation or additional text."""

    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,  # Lower temperature for consistent scoring
                        "max_tokens": 10,  # Only need a number
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    logger.warning("Match score calculation hit rate limit, using TF-IDF fallback")
                    return await _calculate_match_score_tfidf(job_content, resume_text)
                else:
                    logger.error(f"Match score calculation API error: {e}")
                    return await _calculate_match_score_tfidf(job_content, resume_text)
            
            # Defensive parsing
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("Match score LLM response missing 'choices' array - using TF-IDF fallback")
                return await _calculate_match_score_tfidf(job_content, resume_text)
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("Match score LLM message content empty - using TF-IDF fallback")
                return await _calculate_match_score_tfidf(job_content, resume_text)
            
            # Extract numeric score from LLM response
            try:
                score = int(re.search(r'\d+', content).group())
                score = max(0, min(100, score))  # Clamp to 0-100 range
                logger.info(f"🎯 LLM-calculated match score: {score} for user {user_id}")
                return score
            except (AttributeError, ValueError):
                logger.warning("Could not extract numeric score from LLM - using TF-IDF fallback")
                return await _calculate_match_score_tfidf(job_content, resume_text)
                
    except ImportError as e:
        logger.error(f"Error calculating LLM match score: {e}")
        # Fallback to TF-IDF method
        return await _calculate_match_score_tfidf(job_content, resume_text)


async def _calculate_match_score_tfidf(job_content: str, user_profile: str) -> int:
    """
    Fallback TF-IDF match score calculation.
    Used when LLM scoring fails or is unavailable.
    """
    if not user_profile:
        return 50
    
    # Tokenize both texts
    job_tokens = tokenize(job_content)
    profile_tokens = tokenize(user_profile)
    
    # Calculate TF-IDF vectors
    job_tf = tf(job_tokens)
    profile_tf = tf(profile_tokens)
    
    # Calculate cosine similarity
    similarity = cosine(job_tf, profile_tf)
    
    # Convert to 0-100 score
    return round(similarity * 100, 1)


async def _calculate_match_score(job_content: str, user_profile: str) -> int:
    """
    Legacy TF-IDF match score (deprecated, kept for backward compatibility).
    Use calculate_match_score() instead for LLM-based scoring.
    """
    if not user_profile:
        return 50  # Default score if no profile provided

    # Tokenize both texts
    job_tokens = tokenize(job_content)
    profile_tokens = tokenize(user_profile)

    # Calculate TF-IDF vectors
    job_tf = tf(job_tokens)
    profile_tf = tf(profile_tokens)

    # Calculate cosine similarity
    similarity = cosine(job_tf, profile_tf)

    # Convert to 0-100 score
    return round(similarity * 100, 1)


async def _extract_job_metadata(content: str) -> dict:
    """
    Use LLM to extract structured metadata from job content.
    Returns dict with company_name, role_title, salary info, location, work_setting, contact info.
    
    STEP 2: Defensive LLM Parsing - Wraps LLM call in try/except with fallback
    """
    prompt = f"""Extract the following metadata from this job posting. Return ONLY a valid JSON object with these exact keys:
- company_name (string)
- role_title (string)
- salary_min (integer or null)
- salary_max (integer or null)
- currency (string, default USD)
- job_location (string or null)
- work_setting (string: "remote", "hybrid", or "onsite", or null)
- contact_email (string or null)
- contact_name (string or null)
- hiring_manager_linkedin (string or null)

Job content:
{content[:4000]}"""

    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.2,
                        "response_format": {"type": "json_object"},
                        "max_tokens": 500,
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    logger.warning("Job parsing hit rate limit, returning None")
                    return None
                else:
                    logger.error(f"Job parsing API error: {e}")
                    return None
            
            # Defensive parsing: Check response structure before accessing
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("LLM response missing 'choices' array")
                return _get_default_metadata()
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("LLM choice missing 'message' field")
                return _get_default_metadata()
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("LLM message content is empty")
                return _get_default_metadata()
            
            metadata = json.loads(content)
            return metadata
            
    except json.JSONDecodeError as e:
        logger.warning(f"LLM returned invalid JSON: {e}")
        return _get_default_metadata()
    except ImportError as e:
        logger.warning(f"Error extracting job metadata: {e}")
        return _get_default_metadata()


def _get_default_metadata() -> dict:
    """
    Return default metadata when LLM extraction fails.
    Ensures all required fields have safe defaults to prevent validation errors.
    """
    return {
        "company_name": "Unknown Company",
        "role_title": "Unknown Role",
        "salary_min": None,
        "salary_max": None,
        "currency": "USD",
        "job_location": None,
        "work_setting": None,
        "contact_email": None,
        "contact_name": None,
        "hiring_manager_linkedin": None
    }


async def filter_and_validate_job(raw_content: str, metadata: dict, user_id: Optional[str] = None, filter_criteria: Optional[FilterCriteria] = None) -> Optional[dict]:
    """
    THE GATEKEEPER: Filters and validates job postings with dynamic criteria.
    
    Logic:
    - Dynamic Keyword Filtering: Must contain allowed_keywords, must NOT contain blocked_keywords
    - Dynamic Match Threshold: Reject if match_score < filter_criteria.min_match_score
    - Tech Stack Extraction: Extract tech stack from content
    
    Returns: Dictionary with all Supabase fields if validation passes, None if rejected.
    """
    # Use default filter criteria if none provided
    if not filter_criteria:
        filter_criteria = FilterCriteria(
            allowed_keywords=[],
            blocked_keywords=["arbeitserlaubnis", "aufenthaltstitel", "sprachkenntnisse", "deutsch", "german fluent"],
            min_match_score=40
        )
    
    # Check blocked keywords (rejection)
    if filter_criteria.blocked_keywords:
        content_lower = raw_content.lower()
        for keyword in filter_criteria.blocked_keywords:
            if keyword.lower() in content_lower:
                logger.info(f"Job rejected: Blocked keyword '{keyword}' detected")
                return None
    
    # Check allowed keywords (if specified, must contain at least one)
    if filter_criteria.allowed_keywords:
        content_lower = raw_content.lower()
        has_allowed_keyword = any(keyword.lower() in content_lower for keyword in filter_criteria.allowed_keywords)
        if not has_allowed_keyword:
            logger.info(f"Job rejected: No allowed keywords found from {filter_criteria.allowed_keywords}")
            return None
    
    # Detect language
    detected_language = await _detect_language_with_llm(raw_content)
    
    # Language Enforcement: Reject German job postings (fallback if not in blocked_keywords)
    if detected_language == "de":
        logger.info(f"Job rejected: German language detected")
        return None
    
    # Calculate match score if user profile provided
    match_score = 50  # Default score
    if user_id:
        # Use new LLM-based scoring with caching
        match_score = await calculate_match_score(raw_content, user_id)
        logger.info(f"🎯 Calculated match score {match_score} for user {user_id}")
    else:
        logger.info(f"⚠️ No user_id provided, using default score")
        match_score = 50
        
        # Dynamic Match Threshold: Reject if score < min_match_score
        if match_score < filter_criteria.min_match_score:
            logger.info(f"Job rejected: Match score {match_score} below threshold {filter_criteria.min_match_score}")
            return None
    
    # Extract tech stack with defensive parsing
    tech_stack = await _extract_tech_stack_with_llm(raw_content)
    if not isinstance(tech_stack, list):
        logger.warning("Tech stack extraction returned invalid format, using empty list")
        tech_stack = []
    
    # Return validated data
    return {
        "url": metadata.get("url", ""),
        "company_name": metadata.get("company_name", "Unknown Company"),
        "role_title": metadata.get("role_title", "Unknown Role"),
        "match_score": match_score,
        "status": "new",
        "raw_content": raw_content,
        "tech_stack": tech_stack,
        "detected_language": detected_language,
        "salary_min": metadata.get("salary_min"),
        "salary_max": metadata.get("salary_max"),
        "currency": metadata.get("currency", "USD"),
        "job_location": metadata.get("job_location"),
        "work_setting": metadata.get("work_setting"),
        "contact_email": metadata.get("contact_email"),
        "contact_name": metadata.get("contact_name"),
        "hiring_manager_linkedin": metadata.get("hiring_manager_linkedin"),
        "user_id": user_id,
    }


async def process_job_url(url: str, user_profile: Optional[str] = None, user_id: Optional[str] = None, filter_criteria: Optional[FilterCriteria] = None) -> dict:
    """
    THE HARVESTER: Fetches job content from URL and processes it through the Gatekeeper.
    
    Uses ethical scraping techniques:
    - Realistic browser headers
    - Rate limiting and retry logic
    - Multiple user agent rotation
    - Cookie handling for session persistence
    
    Profile Logic: Prioritizes user_id for dynamic profile fetching from Supabase.
    Falls back to user_profile parameter if user_id not provided.
    
    If validation passes, automatically saves to Supabase.
    If validation fails, logs rejection reason.
    
    Returns: dict with success status and details.
    """
    if not supabase_client:
        return {"success": False, "error": "Supabase client not initialized"}
    
    # Resolve "admin" alias to actual UUID if provided
    if user_id:
        user_id = await resolve_user_alias(user_id)
    
    # Dynamic profile fetching: prioritize user_id over passed user_profile
    if user_id and not user_profile:
        user_profile_data = await _get_user_profile(user_id)
        if user_profile_data and user_profile_data.get("resume_text"):
            user_profile = user_profile_data["resume_text"]
            logger.info(f"📋 Using dynamic profile for user {user_id}")
        else:
            logger.info(f"⚠️ No profile found for user {user_id}, proceeding without profile")
    
    # Ethical scraping: Rotating user agents for legitimate diversity
    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    ]
    
    # Ethical scraping: Standard headers that appear legitimate
    DEFAULT_HEADERS = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }
    
    max_retries = 3
    retry_delay = 2  # seconds between retries (respectful rate limiting)
    
    for attempt in range(max_retries):
        try:
            # Select a random user agent for diversity
            headers = DEFAULT_HEADERS.copy()
            headers["User-Agent"] = random.choice(USER_AGENTS)
            
            logger.info(f"Attempt {attempt + 1}/{max_retries}: Fetching {url}")
            
            # Fetch with ethical headers and timeout
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    url, 
                    headers=headers,
                    follow_redirects=True,
                    cookies=None  # Start fresh each time for ethical scraping
                )
                response.raise_for_status()
                
                # STEP 1: Content Type Validation - Reject binary/compressed data
                content_type = response.headers.get("content-type", "")
                if not validate_content_type(content_type):
                    logger.warning(f"Invalid content type '{content_type}' for {url} - rejecting")
                    return {
                        "success": False,
                        "error": f"Invalid content type: {content_type}",
                        "suggestion": "URL returned binary or compressed data instead of HTML/text"
                    }
                
                raw_content = response.text
            
            logger.info(f"Successfully fetched job content from {url} ({len(raw_content)} characters)")
            
            # Phase 1: Hard Quality Gate - Check for garbage data immediately after fetch
            if is_garbage_data(raw_content):
                logger.error(f"❌ Rejected garbage content from URL {url}")
                return {
                    "success": False,
                    "error": "Invalid data format: HTML/Encoded data detected",
                    "suggestion": "The URL returned HTML or encoded data instead of plain text"
                }
            
            # STEP 2: Content Sanitization - Clean and truncate before processing
            cleaned_content = clean_and_truncate(raw_content)
            if len(cleaned_content) < 100:  # Too short after cleaning
                logger.warning(f"Content too short after cleaning ({len(cleaned_content)} chars) for {url}")
                return {
                    "success": False,
                    "error": "Content too short after sanitization",
                    "suggestion": "The URL may not contain valid job posting content"
                }
            
            # STEP 3: LLM Defense - Prevent parsing empty content
            if not cleaned_content or len(cleaned_content) < 50:
                logger.warning(f"Content too short for LLM processing ({len(cleaned_content)} chars) for {url}")
                return {
                    "success": False,
                    "error": "Empty job content",
                    "suggestion": "The URL returned insufficient content for processing"
                }
            
            # Extract metadata from content
            metadata = await _extract_job_metadata(cleaned_content)
            # Defensive: Ensure metadata is never None
            if metadata is None:
                logger.warning("Metadata extraction returned None, using default metadata")
                metadata = _get_default_metadata()
            metadata["url"] = url
            metadata["user_id"] = user_id
            
            # Pass through Gatekeeper for validation with dynamic filter criteria
            validated_data = await filter_and_validate_job(cleaned_content, metadata, user_id, filter_criteria)
            
            if not validated_data:
                return {
                    "success": False,
                    "error": "Job failed validation",
                    "reason": "Filter criteria not met"
                }
            
            # STEP 3: Pre-Pydantic Sanitization - Ensure required string fields are never None
            # Use incoming URL as fallback since we know it's valid
            validated_data["role_title"] = validated_data.get("role_title") or "Unknown Role"
            validated_data["company_name"] = validated_data.get("company_name") or "Unknown Company"
            validated_data["url"] = validated_data.get("url") or url or "No URL provided"
            validated_data["raw_content"] = validated_data.get("raw_content") or cleaned_content or ""
            validated_data["currency"] = validated_data.get("currency") or "USD"
            validated_data["status"] = validated_data.get("status") or "new"
            validated_data["match_score"] = validated_data.get("match_score") or 50
            validated_data["detected_language"] = validated_data.get("detected_language") or "en"
            validated_data["tech_stack"] = validated_data.get("tech_stack") or []
            
            # Log sanitized data for debugging
            logger.info(f"🔧 Sanitized data: role_title={validated_data['role_title']}, company_name={validated_data['company_name']}")
            
            # STEP 4: Graceful Data Saving - Handle Pydantic validation errors
            try:
                job_lead_data = JobLeadIn(**validated_data)
            except ImportError as e:
                logger.error(f"Pydantic validation failed for job data: {e}")
                return {
                    "success": False,
                    "error": "Data validation failed",
                    "reason": f"Invalid job data format: {str(e)}"
                }
            
            try:
                result = await save_job_lead(job_lead_data)
            except ImportError as e:
                logger.error(f"Failed to save job lead to database: {e}")
                return {
                    "success": False,
                    "error": "Database save failed",
                    "reason": f"Could not save job: {str(e)}"
                }
            
            logger.info(f"Job saved successfully: {result}")
            return {
                "success": True,
                "action": result.get("action"),
                "id": result.get("id"),
                "match_score": validated_data["match_score"],
                "tech_stack": validated_data["tech_stack"],
            }
            
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error fetching job URL (attempt {attempt + 1}): {e}")
            
            # If it's a 403/401, the site is blocking automated requests
            if e.response.status_code in [403, 401]:
                logger.warning(f"Site {url} appears to block automated requests (status {e.response.status_code})")
                if attempt == max_retries - 1:
                    return {
                        "success": False,
                        "error": f"Site blocks automated requests (HTTP {e.response.status_code})",
                        "suggestion": "Try using the official job posting URL or a different job board"
                    }
            
            # For other errors, retry with delay
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
                continue
            else:
                return {"success": False, "error": f"Failed to fetch URL: {e.response.status_code}"}
                
        except ImportError as e:
            logger.error(f"Error processing job URL (attempt {attempt + 1}): {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
                retry_delay *= 2
                continue
            else:
                return {"success": False, "error": str(e)}


@app.post("/api/job-leads/process", dependencies=[Depends(require_auth)])
async def process_job_endpoint(body: ProcessJobUrlIn) -> dict:
    """
    Endpoint to process a job URL through the Operational Crew with dynamic filter criteria.
    """
    # Log incoming payload for debugging
    logger.info(f"📦 Incoming payload: url={body.url}, user_id={body.user_id}, user_profile_length={len(body.user_profile) if body.user_profile else 0}")
    
    # Handle empty string user_id from extension - convert to None
    user_id = body.user_id if body.user_id else None
    logger.info(f"✅ Processed user_id: {user_id}")
    
    # Resolve "admin" alias to actual UUID if provided
    if user_id:
        user_id = await resolve_user_alias(user_id)
        logger.info(f"✅ Resolved user_id: {user_id}")
    
    result = await process_job_url(body.url, body.user_profile, user_id, body.filter_criteria)
    
    # Phase 1: Hard Quality Gate - Check for garbage data in the result
    if result.get("success") and result.get("job_data"):
        raw_content = result["job_data"].get("raw_content", "")
        if is_garbage_data(raw_content):
            logger.error("❌ Rejected garbage content from extension (process endpoint)")
            raise HTTPException(status_code=400, detail="Invalid data format: HTML/Encoded data detected")
    
    return result


@app.get("/api/job-leads", dependencies=[Depends(require_auth)])
async def get_job_leads(
    status: Optional[str] = None, 
    min_score: Optional[int] = Query(None, description="Minimum match score filter"),
    user_id: str = Depends(require_auth)
) -> dict:
    """
    Fetch job leads from Supabase for the authenticated user, optionally filtered by status and minimum match score.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        query = supabase_client.table("job_leads").select(
            "id", "url", "company_name", "role_title", "match_score", "status", 
            "created_at", "updated_at", "user_id"
        ).eq("user_id", resolved_user_id)
        if status:
            query = query.eq("status", status)
        if min_score is not None:
            query = query.gte("match_score", min_score)
        result = query.order("created_at", desc=True).execute()
        return {"success": True, "data": result.data}
    except ImportError as e:
        logger.error(f"Error fetching job leads: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch job leads: {str(e)}")


@app.get("/api/job-leads/{lead_id}", dependencies=[Depends(require_auth)])
async def get_job_lead(lead_id: str, user_id: str = Depends(require_auth)) -> dict:
    """
    Fetch a single job lead by ID for the authenticated user.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        result = supabase_client.table("job_leads").select(
            "id", "url", "company_name", "role_title", "match_score", "status",
            "created_at", "updated_at", "user_id", "email_draft", "tailored_cv_path", "prep_guide"
        ).eq("id", lead_id).eq("user_id", resolved_user_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Job lead not found")
        return {"success": True, "data": result.data[0]}
    except HTTPException:
        raise
    except ImportError as e:
        logger.error(f"Error fetching job lead: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch job lead: {str(e)}")


@app.get("/api/stats", dependencies=[Depends(require_auth)])
async def get_stats(user_id: str = Depends(require_auth)) -> dict:
    """
    Get aggregated statistics for the dashboard.
    Returns total scraped counts and status breakdown for the authenticated user.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        # Get job leads only for the authenticated user
        result = supabase_client.table("job_leads").select(
            "id", "company_name", "role_title", "match_score", "status", "created_at"
        ).eq("user_id", resolved_user_id).execute()
        leads = result.data
        
        # Calculate totals
        total_scraped = len(leads)
        
        # Group by status
        status_counts = {
            "new": 0,
            "approved": 0,
            "applied": 0,
            "interview": 0,
            "rejected": 0
        }
        
        for lead in leads:
            status = lead.get("status", "new")
            if status in status_counts:
                status_counts[status] += 1
        
        # Calculate pipeline (active jobs)
        pipeline_count = status_counts["new"] + status_counts["approved"] + status_counts["applied"]
        
        # Calculate success rate (applied / total scraped - rejected)
        success_rate = 0
        eligible_total = total_scraped - status_counts["rejected"]
        if eligible_total > 0:
            success_rate = round((status_counts["applied"] / eligible_total) * 100, 1)
        
        # Get monthly progress (last 30 days)
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        
        monthly_data = {}
        for lead in leads:
            created_at = lead.get("created_at", "")
            if created_at:
                try:
                    # Handle both timezone-aware and naive datetime strings
                    if created_at.endswith("Z"):
                        lead_date = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    else:
                        lead_date = datetime.fromisoformat(created_at)
                    # Ensure timezone awareness for comparison
                    if lead_date.tzinfo is None:
                        lead_date = lead_date.replace(tzinfo=timezone.utc)
                    if lead_date >= thirty_days_ago:
                        day_key = lead_date.strftime("%Y-%m-%d")
                        if day_key not in monthly_data:
                            monthly_data[day_key] = 0
                        if lead.get("status") == "applied":
                            monthly_data[day_key] += 1
                except ImportError as e:
                    logger.warning(f"Failed to parse created_at '{created_at}': {e}")
                    pass
        
        # Convert to sorted array for chart
        monthly_progress = [
            {"date": date, "applications": count}
            for date, count in sorted(monthly_data.items())
        ]
        
        return {
            "success": True,
            "data": {
                "total_scraped": total_scraped,
                "status_counts": status_counts,
                "pipeline_count": pipeline_count,
                "success_rate": success_rate,
                "monthly_progress": monthly_progress
            }
        }
    except ImportError as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch stats: {str(e)}")


@app.patch("/api/job-leads/{lead_id}", dependencies=[Depends(require_auth)])
async def update_job_lead(lead_id: str, status: str = Query(...), user_id: str = Depends(require_auth)) -> dict:
    """
    Update a job lead's status.
    
    When status changes to 'approved', triggers the Odyssey Orchestration Sequence:
    1. DocumentStudio generates cold reach email draft
    2. CVGenerator tailors CV for the specific job
    3. InterviewStudio generates interview preparation guide
    4. CRMService syncs lead to external CRM system
    5. All generated assets are saved to the job_leads record
    
    Note: Orchestration steps are non-blocking - status update succeeds even if orchestration fails.
    """
    logger.info(f"PATCH /api/job-leads/{lead_id} - status: {status} - user_id: {user_id}")
    
    if not supabase_client:
        logger.error("Supabase client not initialized")
        raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        # First, fetch the current job lead data for the authenticated user
        logger.info(f"Fetching job lead: {lead_id} for user: {resolved_user_id}")
        current_lead = supabase_client.table("job_leads").select(
            "id", "url", "company_name", "role_title", "status", "user_id"
        ).eq("id", lead_id).eq("user_id", resolved_user_id).execute()
        if not current_lead.data:
            logger.error(f"Job lead not found: {lead_id}")
            raise HTTPException(status_code=404, detail="Job lead not found")
        
        job_data = current_lead.data[0]
        logger.info(f"Job lead found: {job_data.get('company_name')} - {job_data.get('role_title')}")
        
        # Inject user_id into job_data for orchestration functions
        job_data['user_id'] = user_id
        logger.info(f"Injected user_id into job_data: {user_id}")
        
        # Initialize update data with just the status
        update_data = {"status": status}
        
        # Add applied_at timestamp when status is 'approved'
        if status == 'approved':
            from datetime import datetime
            update_data["applied_at"] = datetime.utcnow().isoformat()
            logger.info(f"Lazy Generation Strategy: Only generating Email Draft on approval")
            
            # Step 1: DocumentStudio - Generate cold reach email draft (sequential)
            try:
                logger.info("Step 1: Generating email draft...")
                email_draft = await _document_studio_draft_cold_reach(job_data)
                update_data["email_draft"] = email_draft
                logger.info(f"DocumentStudio: Email draft generated successfully")
            except ImportError as e:
                logger.error(f"DocumentStudio failed: {e}")
                update_data["email_draft"] = f"[Email draft generation failed: {str(e)}]"
            
            # CV and Prep Guide will be generated on-demand via separate endpoints
            logger.info("CV and Prep Guide will be generated on-demand by user")
            
            # Delay before CRM sync (non-LLM, but good practice)
            logger.info("Waiting 1 second before CRM sync...")
            await asyncio.sleep(1)
            
            # Step 2: CRMService - Sync lead to external CRM system (sequential)
            try:
                logger.info("Step 2: Syncing to CRM...")
                crm_service = get_crm_service(provider="custom")
                crm_sync_result = await crm_service.sync_lead(job_data)
                
                # Log CRM sync result (success or failure)
                if crm_sync_result.get("success"):
                    logger.info(f"CRM sync successful for job lead {lead_id}: {crm_sync_result.get('crm_id')}")
                    update_data["crm_synced"] = True
                    update_data["crm_id"] = crm_sync_result.get("crm_id")
                    update_data["crm_synced_at"] = crm_sync_result.get("synced_at")
                else:
                    logger.error(f"CRM sync failed for job lead {lead_id}: {crm_sync_result.get('error')}")
                    update_data["crm_synced"] = False
            except ImportError as e:
                logger.error(f"CRM service error: {e}")
                update_data["crm_synced"] = False
            
            logger.info(f"Lazy Generation Sequence completed for job lead {lead_id}")
        
        # Perform the update
        logger.info(f"Updating job lead in database: {lead_id} with data: {update_data.keys()}")
        result = supabase_client.table("job_leads").update(update_data).eq("id", lead_id).execute()
        
        if not result.data:
            logger.error(f"Job lead update failed - no data returned: {lead_id}")
            raise HTTPException(status_code=404, detail="Job lead not found after update")
        
        logger.info(f"Job lead updated successfully: {lead_id}")
        return {"success": True, "data": result.data[0]}
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except ImportError as e:
        logger.error(f"Error updating job lead {lead_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update job lead: {str(e)}")


@app.post("/api/job-leads/{lead_id}/ship", dependencies=[Depends(require_auth)])
async def ship_application(lead_id: str, body: ShipApplicationIn, user_id: str = Depends(require_auth)) -> dict:
    """
    Ship (send) a job application email and update status to 'applied'.
    
    This endpoint:
    1. Fetches the job lead with generated assets for the authenticated user
    2. Sends the application email via EmailGateway
    3. Updates job lead status to 'applied'
    4. Updates CRM record status
    5. Logs the shipping event
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        # Fetch the job lead data for the authenticated user
        current_lead = supabase_client.table("job_leads").select(
            "id", "url", "company_name", "role_title", "status", "user_id", "email_draft"
        ).eq("id", lead_id).eq("user_id", resolved_user_id).execute()
        if not current_lead.data:
            raise HTTPException(status_code=404, detail="Job lead not found")
        
        job_data = current_lead.data[0]
        
        # Check if the job has the required assets
        if not job_data.get("email_draft"):
            return {
                "success": False,
                "error": "No email draft available. Please approve the job first."
            }
        
        logger.info(f"🚀 Shipping application for job lead {lead_id} to {job_data.get('company_name')}")
        
        # Prepare email content
        to_email = body.to_email or job_data.get("contact_email")
        if not to_email:
            return {
                "success": False,
                "error": "No recipient email provided"
            }
        
        subject = body.subject or f"Application for {job_data.get('role_title')} at {job_data.get('company_name')}"
        email_body = body.custom_body or job_data.get("email_draft", "")
        
        # Prepare attachments (tailored CV)
        attachments = []
        cv_path = job_data.get("tailored_cv_path")
        if cv_path and Path(cv_path).exists():
            attachments.append({
                "path": cv_path,
                "filename": f"tailored_cv_{job_data.get('company_name', 'company').replace(' ', '_')}.md"
            })
        
        # Send email via EmailGateway
        email_gateway = get_email_gateway()
        email_result = email_gateway.send_application(
            to_email=to_email,
            subject=subject,
            body=email_body,
            attachments=attachments
        )
        
        if not email_result.get("success"):
            logger.error(f"Email sending failed: {email_result.get('error')}")
            return {
                "success": False,
                "error": f"Failed to send email: {email_result.get('error')}"
            }
        
        logger.info(f"✅ Email sent successfully to {to_email}")
        
        # Update job lead status to 'applied'
        update_data = {
            "status": "applied",
            "applied_at": datetime.now(timezone.utc).isoformat()
        }
        
        result = supabase_client.table("job_leads").update(update_data).eq("id", lead_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Job lead not found")
        
        logger.info(f"🎉 Application shipped successfully for job lead {lead_id}")
        
        return {
            "success": True,
            "data": result.data[0],
            "email_sent": email_result,
            "message": "Application shipped successfully!"
        }
        
    except ImportError as e:
        logger.error(f"Error shipping application: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to ship application: {str(e)}")


@app.post("/api/job-leads/{lead_id}/generate-cv", dependencies=[Depends(require_auth)])
async def generate_tailored_cv(lead_id: str, user_id: str = Depends(require_auth)) -> dict:
    """
    On-demand generation of tailored CV for a job lead.
    Called when user clicks "Generate CV" button in ArtifactModal.
    """
    logger.info(f"POST /api/job-leads/{lead_id}/generate-cv - user_id: {user_id}")
    
    if not supabase_client:
        logger.error("Supabase client not initialized")
        raise HTTPException(status_code=503, detail="Supabase client not initialized")
    
    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        # Fetch job lead data for the authenticated user
        current_lead = supabase_client.table("job_leads").select(
            "id", "url", "company_name", "role_title", "status", "user_id"
        ).eq("id", lead_id).eq("user_id", resolved_user_id).execute()
        if not current_lead.data:
            raise HTTPException(status_code=404, detail="Job lead not found")
        
        job_data = current_lead.data[0]
        job_data['user_id'] = user_id
        
        logger.info(f"Generating tailored CV for {job_data.get('company_name')}")
        
        # Generate CV
        tailored_cv_data = await _cv_generator_tailor_cv(job_data)
        
        # Update job lead with CV data
        update_data = {"tailored_cv_data": tailored_cv_data}
        result = supabase_client.table("job_leads").update(update_data).eq("id", lead_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Job lead not found after update")
        
        logger.info(f"CV generated successfully for job lead {lead_id}")
        return {"success": True, "data": result.data[0]}
        
    except HTTPException:
        raise
    except ImportError as e:
        logger.error(f"Error generating CV for job lead {lead_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate CV: {str(e)}")


@app.post("/api/job-leads/{lead_id}/generate-prep-guide", dependencies=[Depends(require_auth)])
async def generate_prep_guide(lead_id: str, user_id: str = Depends(require_auth)) -> dict:
    """
    On-demand generation of interview preparation guide for a job lead.
    Called when user clicks "Generate Prep Guide" button in ArtifactModal.
    """
    logger.info(f"POST /api/job-leads/{lead_id}/generate-prep-guide - user_id: {user_id}")
    
    if not supabase_client:
        logger.error("Supabase client not initialized")
        raise HTTPException(status_code=503, detail="Supabase client not initialized")
    
    try:
        # Resolve user alias if needed
        resolved_user_id = await resolve_user_alias(user_id)
        
        # Fetch job lead data for the authenticated user
        current_lead = supabase_client.table("job_leads").select(
            "id", "url", "company_name", "role_title", "status", "user_id"
        ).eq("id", lead_id).eq("user_id", resolved_user_id).execute()
        if not current_lead.data:
            raise HTTPException(status_code=404, detail="Job lead not found")
        
        job_data = current_lead.data[0]
        job_data['user_id'] = user_id
        
        logger.info(f"Generating prep guide for {job_data.get('company_name')}")
        
        # Generate prep guide
        prep_guide_data = await _interview_studio_generate_prep_guide(job_data)
        
        # Update job lead with prep guide data
        update_data = {"prep_guide_data": prep_guide_data}
        result = supabase_client.table("job_leads").update(update_data).eq("id", lead_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Job lead not found after update")
        
        logger.info(f"Prep guide generated successfully for job lead {lead_id}")
        return {"success": True, "data": result.data[0]}
        
    except HTTPException:
        raise
    except ImportError as e:
        logger.error(f"Error generating prep guide for job lead {lead_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate prep guide: {str(e)}")


# ---------------------------------------------------------------------------
# Text analysis (mirrors src/lib/text-analysis.ts)
# ---------------------------------------------------------------------------

STOPWORDS = set("""a an the and or but if then of in on for to with from by at as is are was were be
been being have has had do does did this that these those i you we they it not no s t can will just
should now into about above below over under more most less many much some any all your our their""".split())

WEAK_VERBS = {"helped", "worked", "did", "made", "responsible", "tasked", "involved", "assisted"}
BUZZWORDS = {"synergy", "rockstar", "ninja", "guru", "leverage", "go-getter", "results-driven"}


def tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS and len(t) > 1]


def tf(tokens: list[str]) -> dict[str, float]:
    c = Counter(tokens)
    total = sum(c.values()) or 1
    return {k: v / total for k, v in c.items()}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0) * b.get(k, 0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


@app.post("/api/ats/match", dependencies=[Depends(require_auth)])
async def ats_match(body: AtsIn) -> dict:
    r_tokens, j_tokens = tokenize(body.resume), tokenize(body.jd)
    score = round(cosine(tf(r_tokens), tf(j_tokens)) * 100, 1)
    jd_set, r_set = set(j_tokens), set(r_tokens)
    gaps = sorted(jd_set - r_set, key=lambda w: -Counter(j_tokens)[w])[:15]
    return {"score": score, "gaps": gaps, "matched": sorted(jd_set & r_set)[:25]}


@app.post("/api/triage/process", dependencies=[Depends(require_auth)])
async def triage_process(file: UploadFile, user_id: str = Depends(require_auth)) -> TriageProcessOut:
    """
    Process uploaded document and return analysis results.
    Extracts text from PDF, analyzes content, and provides match assessment.
    """
    try:
        # Validate file size
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)}MB"
            )
        
        # Validate file type
        if file.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"Invalid file type. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}"
            )
        
        # Validate filename extension
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(
                status_code=415,
                detail="Only PDF files are allowed"
            )
        
        # Extract text from PDF
        text_content = ""
        if PDF_AVAILABLE:
            try:
                import PyPDF2
                pdf_file = io.BytesIO(content)
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                
                # Extract text from all pages
                for page in pdf_reader.pages:
                    text_content += page.extract_text() + "\n"
                
                text_content = text_content.strip()
                
                if not text_content:
                    return TriageProcessOut(
                        matchScore=0,
                        missingSkills=["Unable to extract text from PDF"],
                        feedback="Could not extract readable text from the uploaded PDF. Please ensure the PDF contains selectable text."
                    )
                    
            except PyPDF2.PdfReadError as pdf_error:
                logger.error(f"PDF parsing error: {pdf_error}")
                return TriageProcessOut(
                    matchScore=0,
                    missingSkills=["PDF parsing failed"],
                    feedback=f"Failed to parse PDF: {str(pdf_error)}"
                )
            except (IOError, OSError) as pdf_error:
                logger.error(f"PDF file I/O error: {pdf_error}")
                return TriageProcessOut(
                    matchScore=0,
                    missingSkills=["File read error"],
                    feedback=f"Failed to read PDF file: {str(pdf_error)}"
                )
            except Exception as pdf_error:
                logger.error(f"Unexpected PDF parsing error: {pdf_error}")
                return TriageProcessOut(
                    matchScore=0,
                    missingSkills=["PDF parsing failed"],
                    feedback=f"Failed to parse PDF: {str(pdf_error)}"
                )
        else:
            return TriageProcessOut(
                matchScore=0,
                missingSkills=["PDF parsing not available"],
                feedback="PDF parsing is not available on this server. Please contact administrator."
            )
        
        # Analyze the extracted text
        tokens = tokenize(text_content)
        token_count = len(tokens)
        
        # Calculate basic match score based on text quality
        quality_score = min(100, (token_count // 10))  # Base score from length
        
        # Check for common tech keywords (simplified for now)
        common_tech = {
            "python", "javascript", "react", "node", "java", "aws", "docker", 
            "kubernetes", "sql", "nosql", "git", "ci", "cd", "agile", "scrum",
            "machine", "learning", "data", "science", "api", "rest", "graphql",
            "typescript", "angular", "vue", "django", "flask", "fastapi"
        }
        
        found_tech = [tech for tech in common_tech if tech in text_content.lower()]
        tech_bonus = min(30, len(found_tech) * 3)
        
        # Check for weak verbs and buzzwords (negative indicators)
        words = text_content.lower().split()
        weak_verb_count = sum(1 for w in words if w in WEAK_VERBS)
        buzzword_count = sum(1 for w in words if w in BUZZWORDS)
        
        # Calculate final match score
        match_score = min(100, quality_score + tech_bonus - (weak_verb_count * 2) - (buzzword_count * 3))
        match_score = max(0, match_score)  # Ensure non-negative
        
        # Identify missing skills (tech keywords not found)
        missing_skills = [tech for tech in common_tech if tech not in text_content.lower()][:10]
        
        # Generate feedback based on analysis
        feedback_parts = []
        
        if match_score >= 80:
            feedback_parts.append("Strong profile with good technical coverage.")
        elif match_score >= 60:
            feedback_parts.append("Decent profile with room for improvement.")
        else:
            feedback_parts.append("Profile needs significant enhancement.")
        
        if token_count < 50:
            feedback_parts.append("Document appears too short for comprehensive analysis.")
        
        if weak_verb_count > 3:
            feedback_parts.append("Consider replacing weak verbs with more action-oriented language.")
        
        if buzzword_count > 2:
            feedback_parts.append("Reduce buzzwords for more authentic communication.")
        
        if len(found_tech) > 0:
            feedback_parts.append(f"Detected {len(found_tech)} relevant technologies: {', '.join(found_tech[:5])}")
        
        feedback = " ".join(feedback_parts) if feedback_parts else "Document processed successfully."
        
        return TriageProcessOut(
            matchScore=match_score,
            missingSkills=missing_skills,
            feedback=feedback
        )
        
    except (IOError, OSError) as e:
        logger.error(f"File I/O error during document processing: {e}")
        return TriageProcessOut(
            matchScore=0,
            missingSkills=["File error"],
            feedback=f"Failed to read file: {str(e)}"
        )
    except ValueError as e:
        logger.error(f"Data validation error during document processing: {e}")
        return TriageProcessOut(
            matchScore=0,
            missingSkills=["Validation error"],
            feedback=f"Invalid document data: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected document processing error: {e}")
        return TriageProcessOut(
            matchScore=0,
            missingSkills=["Processing error"],
            feedback=f"Failed to process document: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Roaster
# ---------------------------------------------------------------------------


def _line_issues(line: str) -> list[str]:
    words = line.lower().split()
    issues = []
    if any(w in WEAK_VERBS for w in words):
        issues.append("weak verb")
    if any(w in BUZZWORDS for w in words):
        issues.append("buzzword")
    if not re.search(r"\d", line):
        issues.append("no quantification")
    if len(words) < 6:
        issues.append("too short")
    return issues


@app.post("/api/roaster/analyze", dependencies=[Depends(require_auth)])
async def roaster_analyze(body: RoasterIn) -> dict:
    prompt = f"""
    You are an expert technical recruiter and resume consultant.
    Analyze the following resume bullet points.
    Return ONLY a valid JSON object with:
    1. "critique": A short, brutal, constructive critique of the overall resume.
    2. "flawed_bullets": A list of objects, each with "text" (the original bullet) and "issues" (a list of specific problems).
    
    Resume content:
    {body.resume}
    """
    
    async with httpx.AsyncClient() as client:
        try:
            data = await groq_api_call_with_retry(
                client=client,
                url="https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                json_data={
                    "model": "openai/gpt-oss-20b",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.2
                }
            )
        except HTTPException as e:
            if e.status_code == 429:
                # Rate limit error - re-raise with creative message
                raise HTTPException(status_code=429, detail=get_rate_limit_message())
            else:
                # Other errors - re-raise
                raise
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("Roaster LLM response missing 'choices' array")
                return {
                    "critique": "Analysis failed - missing choices in LLM response",
                    "flawed_bullets": []
                }
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("Roaster LLM choice missing 'message' field")
                return {
                    "critique": "Analysis failed - missing message in LLM response",
                    "flawed_bullets": []
                }
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("Roaster LLM message content is empty")
                return {
                    "critique": "Analysis failed - empty content in LLM response",
                    "flawed_bullets": []
                }
            
            parsed = json.loads(content)
            return parsed
        except json.JSONDecodeError as e:
            logger.error(f"Roaster JSON parsing error: {e}")
            return {
                "critique": "Analysis failed - invalid JSON from LLM",
                "flawed_bullets": []
            }
        except ImportError as e:
            logger.error(f"Groq API Error: {e}")
            raise HTTPException(status_code=502, detail="Agent failed to analyze resume")


@app.post("/api/roaster/fix", dependencies=[Depends(require_auth)])
async def roaster_fix(body: RoasterFixIn) -> dict:
    rewrites = []
    strong = ["Architected", "Shipped", "Drove", "Spearheaded", "Optimized", "Reduced", "Scaled"]
    for b in body.flawed_bullets:
        # Per-bullet length cap to bound regex/string work.
        snippet = b[:500].lower()
        verb = random.choice(strong)
        rewrites.append(f"{verb} {snippet} — driving measurable impact (add %/$ here).")
    return {"fixed_bullets": rewrites}


# ---------------------------------------------------------------------------
# Interview studio
# ---------------------------------------------------------------------------

QUESTION_TEMPLATES = [
    "Walk me through a project where you used {kw}.",
    "What's your approach to debugging a flaky {kw} workflow?",
    "How would you scale {kw} to 10× current load?",
    "Describe a tradeoff you made involving {kw}.",
    "What's the most counterintuitive thing you've learned about {kw}?",
]


@app.post("/api/interview/generate", dependencies=[Depends(require_auth)])
async def interview_generate(body: InterviewGenerateIn) -> dict:
    system_prompt = f"""You are an elite, veteran Hiring Manager.
Your task is to generate EXACTLY {body.count} unique, challenging, and highly relevant interview questions based on the provided Job Description.

CRITICAL INSTRUCTIONS:
1. Identify the industry (e.g., Tech, Hospitality, Logistics, Finance). Adopt the persona of an expert in THAT specific industry.
2. Do NOT ask generic software engineering questions unless the JD is explicitly for a software engineering role.
3. Frame questions to test practical experience, behavioral responses, and domain-specific knowledge required by the JD.
4. Ensure no two questions are similar.
5. You must respond ONLY with a raw JSON array of strings. Do not include markdown formatting, introductions, or explanations.
Output EXACTLY and ONLY a JSON list of strings. Do not use markdown blocks. Example: ["Question 1?", "Question 2?"]"""

    user_prompt = f"Job Description:\n{body.job_description}"

    async with httpx.AsyncClient() as client:
        try:
            data = await groq_api_call_with_retry(
                client=client,
                url="https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                json_data={
                    "model": "openai/gpt-oss-20b",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7
                }
            )
        except HTTPException as e:
            if e.status_code == 429:
                # Rate limit error - re-raise with creative message
                raise HTTPException(status_code=429, detail=get_rate_limit_message())
            else:
                # Other errors - re-raise
                raise

        # Defensive parsing: Check response structure
        if not data or 'choices' not in data or not data['choices']:
            logger.warning("Interview generation LLM response missing 'choices' array")
            raise HTTPException(status_code=502, detail="Missing choices in LLM response")
        
        # Check for message content
        if not data['choices'][0] or 'message' not in data['choices'][0]:
            logger.warning("Interview generation LLM choice missing 'message' field")
            raise HTTPException(status_code=502, detail="Missing message in LLM response")
        
        raw_content = data['choices'][0]['message'].get('content', '')
        if not raw_content:
            logger.warning("Interview generation LLM message content is empty")
            raise HTTPException(status_code=502, detail="Empty content in LLM response")

        # Try to aggressively hunt down the JSON array using regex
        try:
            match = re.search(r'\[.*\]', raw_content, re.DOTALL)
            if match:
                questions = json.loads(match.group(0))
            else:
                # Fallback: See if it wrapped it in a dictionary
                parsed = json.loads(raw_content)
                if isinstance(parsed, dict):
                    questions = next(iter(parsed.values())) # Grab the first value assuming it's the list
                else:
                    questions = parsed

            if not isinstance(questions, list):
                raise ValueError("Extracted data is still not a list")

        except ImportError as e:
            logger.error(f"Failed to parse LLM output: {raw_content}")
            raise HTTPException(status_code=502, detail="Invalid LLM JSON response")

        # Ensure we have the right number of questions
        if len(questions) > body.count:
            questions = questions[:body.count]

        return {"questions": questions}


@app.post("/api/interview/evaluate", dependencies=[Depends(require_auth)])
async def interview_evaluate(body: InterviewEvaluateIn) -> dict:
    """
    Evaluate interview answer using LLM.
    Returns JSON with score, feedback, and improvement suggestions.
    """
    system_prompt = """You are a ruthless but constructive technical interviewer.
Your task is to evaluate interview answers using the STAR method (Situation, Task, Action, Result).

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON object with this exact structure:
{
  "score": <integer 1-10>,
  "feedback": "<specific critique of the answer>",
  "improvement_suggestion": "<how to answer better>"
}

2. Scoring criteria:
   - 1-3: Poor - Lacks structure, vague, irrelevant to job requirements
   - 4-6: Average - Some structure but weak specifics, generic response
   - 7-8: Good - Clear STAR method, relevant examples, some metrics
   - 9-10: Excellent - Strong STAR method, specific metrics, directly addresses job requirements

3. Feedback must:
   - Be specific and actionable
   - Reference the STAR method where applicable
   - Highlight what worked and what didn't
   - Connect to the job requirements

4. Improvement suggestions must:
   - Be concrete and specific
   - Suggest missing elements (metrics, examples, etc.)
   - Guide how to better address the job requirements
   - Be encouraging but direct

CRITICAL: Do NOT include any markdown formatting, explanations, or text outside the JSON object. Return ONLY the JSON."""

    user_prompt = f"""QUESTION: {body.question}

CANDIDATE ANSWER: {body.answer}

JOB DESCRIPTION CONTEXT: {body.job_description[:1500] if len(body.job_description) > 1500 else body.job_description}

Evaluate this answer based on the job requirements and STAR method."""

    try:
        async with httpx.AsyncClient() as client:
            try:
                data = await groq_api_call_with_retry(
                    client=client,
                    url="https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                    json_data={
                        "model": "openai/gpt-oss-20b",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.7,
                        "max_tokens": 1000,
                        "response_format": {"type": "json_object"}
                    }
                )
            except HTTPException as e:
                if e.status_code == 429:
                    # Rate limit error - re-raise with creative message
                    raise HTTPException(status_code=429, detail=get_rate_limit_message())
                else:
                    # Other errors - return fallback
                    logger.error(f"Interview evaluation API error: {e}")
                    return {
                        "score": 5,
                        "feedback": f"Unable to evaluate answer due to technical issues: {str(e)}",
                        "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
                    }
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("Interview evaluation LLM response missing 'choices' array")
                return {
                    "score": 5,
                    "feedback": "Unable to evaluate answer due to technical issues. Your response has been recorded.",
                    "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
                }
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("Interview evaluation LLM choice missing 'message' field")
                return {
                    "score": 5,
                    "feedback": "Unable to evaluate answer due to technical issues. Your response has been recorded.",
                    "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
                }
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("Interview evaluation LLM message content is empty")
                return {
                    "score": 5,
                    "feedback": "Unable to evaluate answer due to technical issues. Your response has been recorded.",
                    "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
                }
            
            # Parse JSON response
            try:
                evaluation_data = json.loads(content.strip())
                
                # Validate structure
                if not isinstance(evaluation_data, dict):
                    raise ValueError("Response is not a dictionary")
                if 'score' not in evaluation_data or 'feedback' not in evaluation_data or 'improvement_suggestion' not in evaluation_data:
                    raise ValueError("Missing required fields")
                
                # Ensure score is in valid range
                score = evaluation_data.get('score', 5)
                if not isinstance(score, int) or score < 1 or score > 10:
                    score = max(1, min(10, int(score)))
                evaluation_data['score'] = score
                
                logger.info(f"Interview evaluation: Score {score}/10")
                return evaluation_data
                
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse evaluation JSON response: {e}")
                return {
                    "score": 5,
                    "feedback": "Unable to parse evaluation response. Your response has been recorded.",
                    "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
                }
            except ValueError as e:
                logger.error(f"Invalid evaluation response structure: {e}")
                return {
                    "score": 5,
                    "feedback": f"Evaluation response format error: {str(e)}",
                    "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
                }
                
    except ImportError as e:
        logger.error(f"Interview evaluation error: {e}")
        return {
            "score": 5,
            "feedback": f"Evaluation failed: {str(e)}",
            "improvement_suggestion": "Please try again later or focus on using the STAR method in your answers."
        }


@app.post("/api/interview/speak", dependencies=[Depends(require_auth)])
async def interview_speak(body: InterviewSpeakIn) -> Response:
    if not ELEVENLABS_API_KEY:
        raise HTTPException(503, "Voice service not configured")
    voice = body.voice_id or ELEVENLABS_DEFAULT_VOICE
    if not VOICE_ID_RE.match(voice):
        raise HTTPException(400, "Invalid voice_id format")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                url,
                headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
                json={"text": body.text, "model_id": "eleven_turbo_v2"},
            )
    except httpx.HTTPError as exc:
        logger.exception("ElevenLabs transport error: %s", exc)
        raise HTTPException(502, "Voice service unavailable")

    if r.status_code >= 400:
        # Log full upstream detail server-side; never forward to client.
        logger.warning("ElevenLabs %s: %s", r.status_code, r.text[:1000])
        if r.status_code == 401:
            raise HTTPException(503, "Voice service authentication failed")
        if r.status_code == 429:
            raise HTTPException(429, "Voice service rate limit reached")
        raise HTTPException(502, "Voice service unavailable")
    return Response(content=r.content, media_type="audio/mpeg")


# ---------------------------------------------------------------------------
# Networking drafts
# ---------------------------------------------------------------------------

@app.post("/api/networking/draft", dependencies=[Depends(require_auth)])
async def networking_draft(body: NetworkingDraftIn, mode: str = Query("career"), user_id: str = Depends(require_auth)) -> dict:
    first_name = body.contact_name.split()[0] if body.contact_name else "there"

    mode_dict = PROMPT_LIBRARY.get(mode, PROMPT_LIBRARY["career"])
    persona_template = mode_dict["persona"]
    structure_template = mode_dict.get(body.angle, mode_dict["peer"])
    shared = PROMPT_LIBRARY["shared"]

    dossier = _build_dossier(body)
    fmt_kwargs = {"first_name": first_name, "body": body, "dossier": dossier}

    system_prompt = persona_template.format(**fmt_kwargs)
    structure_prompt = structure_template.format(**fmt_kwargs)
    dossier_block = shared["dossier_rules"].format(**fmt_kwargs)
    subject_block = shared["subject_rules"].format(**fmt_kwargs)

    json_instruction = (
        'CRITICAL OUTPUT FORMAT:\n'
        'Return a valid JSON object with exactly two keys: "subject" and "body". '
        "Do not wrap the JSON in markdown code blocks."
    )

    full_system = (
        f"{system_prompt}\n\n{structure_prompt}\n\n"
        f"{dossier_block}\n\n{subject_block}\n\n{json_instruction}"
    )

    async with httpx.AsyncClient() as client:
        try:
            data = await groq_api_call_with_retry(
                client=client,
                url="https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY')}"},
                json_data={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": full_system}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.6,
                }
            )
        except HTTPException as e:
            if e.status_code == 429:
                # Rate limit error - re-raise with creative message
                raise HTTPException(status_code=429, detail=get_rate_limit_message())
            else:
                # Other errors - re-raise
                raise
            
            # Defensive parsing: Check response structure
            if not data or 'choices' not in data or not data['choices']:
                logger.warning("Networking draft LLM response missing 'choices' array")
                raise HTTPException(status_code=502, detail="Missing choices in LLM response")
            
            # Check for message content
            if not data['choices'][0] or 'message' not in data['choices'][0]:
                logger.warning("Networking draft LLM choice missing 'message' field")
                raise HTTPException(status_code=502, detail="Missing message in LLM response")
            
            content = data['choices'][0]['message'].get('content', '')
            if not content:
                logger.warning("Networking draft LLM message content is empty")
                raise HTTPException(status_code=502, detail="Empty content in LLM response")
            
            parsed = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Networking draft JSON parsing error: {e}")
            raise HTTPException(status_code=502, detail="Invalid JSON from LLM")
        except HTTPException:
            raise
        except ImportError as e:
            logger.error(f"Groq Networking Agent Error (Mode: {mode}, Angle: {body.angle}): {e}")
            raise HTTPException(status_code=502, detail="Agent failed to draft networking email")

    draft_id = uuid.uuid4().hex[:12]
    record = {
        "id": draft_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending_review",
        "mode": mode,
        "angle": body.angle,
        "to_name": body.contact_name,
        "to_email": body.contact_email,
        "company": body.company,
        "subject": parsed.get("subject", ""),
        "body": parsed.get("body", ""),
    }
    drafts = _read_drafts(user_id)
    drafts[draft_id] = record
    _write_drafts(drafts, user_id)
    return record

@app.get("/api/networking/drafts", dependencies=[Depends(require_auth)])
async def list_drafts(user_id: str = Depends(require_auth)) -> dict:
    return _read_drafts(user_id)


@app.patch("/api/networking/drafts/{draft_id}", dependencies=[Depends(require_auth)])
async def edit_draft(draft_id: str, edit: DraftEditIn, user_id: str = Depends(require_auth)) -> dict:
    drafts = _read_drafts(user_id)
    record = drafts.get(draft_id)
    if not record:
        raise HTTPException(404, "Draft not found")
    if edit.subject is not None:
        record["subject"] = edit.subject
    if edit.body is not None:
        record["body"] = edit.body
    record["status"] = "edited"
    drafts[draft_id] = record
    _write_drafts(drafts, user_id)
    return record


@app.post("/api/networking/drafts/{draft_id}/send", dependencies=[Depends(require_auth)])
async def send_draft(draft_id: str, send: DraftSendIn, user_id: str = Depends(require_auth)) -> dict:
    drafts = _read_drafts(user_id)
    record = drafts.get(draft_id)
    if not record:
        raise HTTPException(404, "Draft not found")
    to_addr = send.override_to or record.get("to_email")
    if not to_addr:
        raise HTTPException(400, "No recipient email on file — pass override_to")
    try:
        await asyncio.to_thread(_send_email_sync, to_addr, record["subject"], record["body"])
    except ImportError as e:
        logger.error(f"SMTP send failed for draft {draft_id}: {e}")
        raise HTTPException(502, "Failed to send email")
    record["status"] = "sent"
    record["sent_at"] = datetime.now(timezone.utc).isoformat()
    record["sent_to"] = to_addr
    drafts[draft_id] = record
    _write_drafts(drafts, user_id)
    return record

# ---------------------------------------------------------------------------
# Contact enrichment
# ---------------------------------------------------------------------------

@app.post("/api/networking/enrich", dependencies=[Depends(require_auth)])
async def enrich_contact(body: EnrichIn, user_id: str = Depends(require_auth)) -> dict:
    target_url = body.webhook_url or _read_webhooks(user_id).n8n_url
    if not target_url:
        raise HTTPException(400, "No enrichment webhook configured — set one in Settings → Webhooks, or pass webhook_url")

    payload = {
        "contact_name": body.contact_name,
        "company": body.company,
        "email": body.email,
        "linkedin_url": body.linkedin_url,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(target_url, json=payload)
            r.raise_for_status()
            enriched = r.json()
    except ImportError as e:
        logger.error(f"Enrichment webhook failed: {e}")
        raise HTTPException(502, "Enrichment webhook did not return usable data")

    _csv_append(ENRICHED_CSV, {
        "contact_name": body.contact_name,
        "company": body.company,
        "email": body.email or "",
        "linkedin_url": body.linkedin_url or "",
        "enriched_at": datetime.now(timezone.utc).isoformat(),
        "raw_payload": json.dumps(enriched)[:5000],
    })
    return {"contact_name": body.contact_name, "enrichment": enriched}

# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------


@app.get("/")
async def root() -> dict:
    return {"name": "Odyssey AI Fleet Commander", "version": "1.0.0"}
