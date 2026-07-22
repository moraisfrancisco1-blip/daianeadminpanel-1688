import { handle } from "hono/vercel";
import app from "../src/api";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
