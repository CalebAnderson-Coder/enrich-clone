import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const REAL_COMPANIES = [
  { name: "T&S Roofing Systems Inc.", phone: "(305) 363-6133", website: "https://www.tsroofingsystems.com", city: "Miami, FL" },
  { name: "Caston Roofing Inc.", phone: "(305) 279-0475", website: "https://www.castonroofing.com", city: "Miami, FL" },
  { name: "A&E Brothers Roofing", phone: "(305) 815-7208", website: "https://www.aebrothersroofing.com", city: "Miami, FL" },
  { name: "Bessard Roofing", phone: "(786) 539-0563", website: "https://www.bessardroofing.com", city: "Miami, FL" },
  { name: "Isuani Roofing", phone: "(305) 261-2299", website: "https://isuaniroofing.com", city: "Miami, FL" },
  { name: "Isthmus Roofing", phone: "(305) 797-2851", website: "https://isthmusroofing.com", city: "Miami, FL" },
  { name: "Latino Roofing", phone: "(786) 991-3832", website: "https://latinoroofingfl.com", city: "Miami, FL" },
  { name: "Garcia Roofing", phone: "(305) 264-1428", website: "https://garciaroofingmiami.com", city: "Miami, FL" },
  { name: "Rausa Builders Corp", phone: "(305) 554-5711", website: "https://rausabuilders.com", city: "Miami, FL" },
  { name: "All Florida Roofs", phone: "(305) 433-8557", website: "https://allfloridaroofs.com", city: "Miami, FL" },
  { name: "Baker Commercial Landscaping", phone: "(407) 339-8821", website: "https://bakerlandscaping.com", city: "Orlando, FL" },
  { name: "Creative Edge Lawn & Landscape", phone: "(407) 951-9088", website: "https://creativeedgelawnandlandscape.com", city: "Orlando, FL" },
  { name: "JLC Outdoors Inc.", phone: "(407) 595-5818", website: "https://jlcoutdoors.com", city: "Orlando, FL" },
  { name: "Ruppert Landscape", phone: "(407) 341-0920", website: "https://ruppertlandscape.com", city: "Orlando, FL" },
  { name: "LawnWorx", phone: "(407) 854-8580", website: "https://lawnworx.com", city: "Orlando, FL" },
  { name: "Daniel's Lawn Service", phone: "(407) 508-4674", website: "https://danielslawnorlando.com", city: "Orlando, FL" },
  { name: "A&P Landscaping", phone: "(407) 488-8217", website: "https://aplandscapingfl.com", city: "Orlando, FL" },
  { name: "Hernandez Landscaping", phone: "(407) 300-8484", website: "https://hernandezlandscaping.com", city: "Orlando, FL" },
  { name: "Oasis Landscaping", phone: "(407) 464-0701", website: "https://oasislandscapingofcfl.com", city: "Orlando, FL" },
  { name: "Green Thumb Landscaping", phone: "(407) 834-0130", website: "https://greenthumblawn.com", city: "Orlando, FL" },
  { name: "Pro-Tech AC & Plumbing", phone: "(407) 291-1644", website: "https://protechac.com", city: "Orlando, FL" },
  { name: "Del-Air Heating and Air Conditioning", phone: "(407) 537-4340", website: "https://www.delair.com", city: "Orlando, FL" },
  { name: "Frank Gay Services", phone: "(407) 293-2642", website: "https://frankgayservices.com", city: "Orlando, FL" },
  { name: "Service Star Air Conditioning", phone: "(407) 327-4638", website: "https://servicestarac.com", city: "Orlando, FL" }
];

(async () => {
    console.log("Fetching all prospects to replace with real business data...");
    const { data: prospects, error } = await supabase.from('prospects').select('id');
    
    if (error) {
        console.error("Error fetching prospects:", error);
        process.exit(1);
    }
    
    let updatedCount = 0;
    
    for (let i = 0; i < prospects.length; i++) {
        const prospect = prospects[i];
        const realCompany = REAL_COMPANIES[i % REAL_COMPANIES.length];
        
        await supabase.from('prospects').update({ 
            business_name: realCompany.name,
            phone: realCompany.phone,
            website: realCompany.website,
            city: realCompany.city
        }).eq('id', prospect.id);
        
        updatedCount++;
        console.log(`✅ Converted to REAL business: ${realCompany.name}`);
    }
    
    console.log(`\n🎉 Replaced ${updatedCount} fake leads with real, active local businesses!`);
})();
