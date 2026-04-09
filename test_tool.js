import dotenv from "dotenv";
dotenv.config();
import { scrapeGoogleMaps } from "./tools/brightDataGoogleMaps.js";

async function test() {
  const result = await scrapeGoogleMaps.fn({
    query: "electrician Dallas TX",
    maxResults: 5,
    minReviews: 10,
    minRating: 4.0
  });
  console.log("Result:", result);
}
test();
