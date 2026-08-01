import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from workspace root or package root
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { app } from "./app";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 AI Lead Generation Central API Engine listening on http://localhost:${PORT}`);
});
