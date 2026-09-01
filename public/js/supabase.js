
const SUPABASE_URL = "https://vumnujygswotstvwljaz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bW51anlnc3dvdHN0dndsamF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTkwNTIsImV4cCI6MjA5NjY5NTA1Mn0.tag4oNAsqqzYkdz6cxANpn5zJJihvk1x4RkuEd8AL0E";
window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);