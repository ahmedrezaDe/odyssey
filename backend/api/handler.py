import sys
import os
import logging

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging for debugging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vercel_handler")

try:
    from api.index import app as fastapi_app
    logger.info("FastAPI app imported successfully")
except Exception as e:
    logger.error(f"Failed to import FastAPI app: {e}")
    import traceback
    traceback.print_exc()
    raise

# Vercel expects 'app' as the entry point
app = fastapi_app