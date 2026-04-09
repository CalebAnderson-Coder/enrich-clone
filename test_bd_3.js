import dotenv from "dotenv";
dotenv.config();

async function test() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  let res = await fetch("https://api.brightdata.com/serp/req?zone=mcp_unlocker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      q: "gardening Miami FL",
      search_engine: "google_maps",
      num: 5
    })
  });
  console.log("Status mcp_unlocker q:", res.status);
  console.log("Body:", await res.text());
}
test();
