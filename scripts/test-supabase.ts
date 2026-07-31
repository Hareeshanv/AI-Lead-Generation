import { dbQueries, dbClient } from "../packages/database/src";

async function testSupabaseConnection() {
  console.log("🔍 Testing Supabase Database Connection...");
  console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);

  try {
    const { data: agents, error } = await dbClient.from("agents").select("*");
    
    if (error) {
      console.error("❌ Supabase Connection Failed:", error.message);
      process.exit(1);
    }

    console.log("✅ Supabase Database Connection Successful!");
    console.log(`📊 Found ${agents?.length || 0} agents in Supabase 'agents' table.`);
    if (agents && agents.length > 0) {
      console.log("Sample Agent:", agents[0].name, "(Status:", agents[0].status + ")");
    }
  } catch (err: any) {
    console.error("❌ Exception connecting to Supabase:", err?.message);
  }
}

testSupabaseConnection();
