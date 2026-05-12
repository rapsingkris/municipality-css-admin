// supabase_client.js
// Load this BEFORE survey_question.js in your HTML.
// Get these values from: Supabase Dashboard → Project Settings → API

const SUPABASE_URL = 'https://ircbidpdgkezxnszzeuu.supabase.co'; // 🔁 Replace this
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyY2JpZHBkZ2tlenhuc3p6ZXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjQ1ODYsImV4cCI6MjA5MjIwMDU4Nn0.OkLuJsyIx1a3AsIb9w7KWEDlyIJfWjQJ9O_fN5KoSMw';             // 🔁 Replace this

window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);