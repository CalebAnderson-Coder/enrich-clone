
const fs = require('fs');
const path = require('path');

const dir = 'src/features/leads';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      results.push(file);
    }
  });
  return results;
}

const files = walk(dir);
files.push('src/app/dashboard/leads/page.tsx');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/Users/g, 'Leads');
  content = content.replace(/users/g, 'leads');
  content = content.replace(/User(?=[A-Z])/g, 'Lead');
  content = content.replace(/user(?=[A-Z])/g, 'lead');
  content = content.replace(/user-/g, 'lead-');
  content = content.replace(/User(?!\w)/g, 'Lead');
  content = content.replace(/user(?!\w)/g, 'lead');
  fs.writeFileSync(file, content, 'utf8');
}
console.log('Done');

