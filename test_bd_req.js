import dotenv from "dotenv";
dotenv.config();

async function test() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  let res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      url: "https://www.google.com/search?q=gardening+Miami+FL&tbm=lcl",
      zone: "mcp_unlocker",
      format: "raw"
    })
  });
  console.log("Status URL request:", res.status);
  const html = await res.text();
  console.log("Body length:", html.length);
  // See if there's any business info text in it
  console.log("Has 'gardening'?", html.includes("gardening"));
}
test();
