import { supabase } from './lib/supabase.js';

async function deleteMockData() {
  console.log('Borrando datos mock de Supabase...');
  try {
    const { data, error } = await supabase
      .from('leads')
      .delete()
      .like('business_name', '%(Mock)%');
      
    if (error) {
      console.error('Error borrando data:', error);
    } else {
      console.log('✅ Datos mock eliminados de la base de datos real.');
    }
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

deleteMockData();
