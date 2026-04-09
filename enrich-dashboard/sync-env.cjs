const { execSync } = require('child_process');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const lines = env.split('\n');

for (const line of lines) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=').trim().replace(/['"']/g, '');
    
    console.log(`Setting ${key} for production...`);
    const command = `npx vercel env rm ${key} production --yes`;
    try { execSync(command, { stdio: 'ignore' }) } catch(e){} 
    
    try {
      execSync(`npx vercel env add ${key} production`, { input: value, stdio: 'inherit' });
      console.log(`Successfully added ${key}`);
    } catch(err) {
      console.error(err.message);
    }
  }
}
