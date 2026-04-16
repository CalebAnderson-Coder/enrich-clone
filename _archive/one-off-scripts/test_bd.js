import dotenv from "dotenv";
dotenv.config();

async function test() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  let res = await fetch("https://api.brightdata.com/serp/req?zone=serp_api1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      query: "gardening Miami FL",
      search_engine: "google_maps",
      country: "us",
      language: "en",
      num: 5
    })
  });
  console.log("Status URL Zone:", res.status);
  console.log("Body:", await res.text());
}
test();
