import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

if not url or not key:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in .env file")

supabase: Client = create_client(url, key)

print("✅ Supabase client connected successfully!")