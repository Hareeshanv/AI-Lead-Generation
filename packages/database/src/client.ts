import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ubdjmnmmonymumvhvedd.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const dbClient: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
