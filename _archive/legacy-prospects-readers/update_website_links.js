import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    console.log("Fetching all prospects to update website links...");
    const { data: prospects, error } = await supabase.from('prospects').select('id, business_name, city, website');
    
    if (error) {
        console.error("Error fetching prospects:", error);
        process.exit(1);
    }
    
    let updatedCount = 0;
    
    for (const prospect of prospects) {
        if (!prospect.website || prospect.website === 'null' || prospect.website.toLowerCase().includes('n/a') || prospect.website.toLowerCase().includes('no website')) {
            const query = encodeURIComponent(`${prospect.business_name} ${prospect.city || ''}`.trim());
            const newLink = `https://www.google.com/search?q=${query}`;
            
            await supabase.from('prospects').update({ website: newLink }).eq('id', prospect.id);
            updatedCount++;
            console.log(`✅ Added Google search link for ${prospect.business_name}: ${newLink}`);
        }
    }
    
    console.log(`\n🎉 Corrected ${updatedCount} blank links successfully!`);
})();
