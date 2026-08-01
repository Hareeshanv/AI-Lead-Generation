import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Find root .env by going up directories
let currentDir = __dirname;
let envPath = "";
for (let i = 0; i < 5; i++) {
  const checkPath = path.resolve(currentDir, ".env");
  if (fs.existsSync(checkPath)) {
    envPath = checkPath;
    break;
  }
  currentDir = path.dirname(currentDir);
}

if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ubdjmnmmonymumvhvedd.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const dbClient: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
