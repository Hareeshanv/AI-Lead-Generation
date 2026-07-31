import { app } from "./app";
import * as dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 AI Lead Generation Central API Engine listening on http://localhost:${PORT}`);
});
