import dotenv from 'dotenv';
dotenv.config();
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_PHONE_NUMBER;
const to = '+16179938515';
const body = "Hey Test Agency Demo, I'm Agencia IA. I was looking at your business on Google and saw you don't have a website (or it's a bit outdated). It's a bit random, but I went ahead and built a new site for you. Do you want me to show it to you?";
const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
const params = new URLSearchParams({To: to, From: from, Body: body});
const r = await fetch(url, {
    method: 'POST',
    headers: {
        'Authorization': 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
});
const j = await r.json();
console.log(r.status, j.sid || j.message || JSON.stringify(j));
