import dotenv from "dotenv";
dotenv.config();

async function test() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  let res = await fetch("https://api.brightdata.com/serp/req", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      query: "gardening Miami FL",
      search_engine: "google_maps",
      num: 5,
      zone: "serp_api1"
    })
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}
test();
