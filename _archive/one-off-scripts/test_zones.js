import dotenv from "dotenv";
dotenv.config();

async function getZones() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  let res = await fetch("https://api.brightdata.com/zone/get_active_zones", {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("Zones:", res.status, await res.text());
}
getZones();
