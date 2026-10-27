import { createClient } from "@supabase/supabase-js/dist/index.cjs";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseKey || !supabaseUrl) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_KEY in environment variables",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
