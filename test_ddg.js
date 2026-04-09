import dotenv from "dotenv";
dotenv.config();

async function testDDG() {
  const res = await fetch("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    },
    body: "q=landscaping+Miami+FL"
  });
  const html = await res.text();
  console.log("DDG Length:", html.length);
  console.log("Snippet:", html.substring(0, 500));
}
testDDG();
