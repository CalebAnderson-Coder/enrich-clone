import { saveProspect } from './supabaseUtils.js';

(async () => {
    console.log("Testing Supabase Insert...");
    const prospect = await saveProspect({
        niche_id: 4,
        city: "Test City",
        business_name: "Test Business",
        raw_data: { test: true }
    });
    console.log("Result:", prospect);
})();
